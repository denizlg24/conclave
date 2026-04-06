import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createProjectManager } from "../project-manager";

const TEST_DIR = join(tmpdir(), "conclave-test-" + Date.now());
const CONCLAVE_HOME = join(TEST_DIR, ".conclave-home");

function uniqueName(base: string): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setupTestEnv() {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(CONCLAVE_HOME, { recursive: true });

  const originalHome = process.env.HOME;
  process.env.HOME = TEST_DIR;

  return () => {
    process.env.HOME = originalHome;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  };
}

describe("ProjectManager", () => {
  let cleanup: () => void;
  let initialProjectCount: number;

  beforeEach(() => {
    cleanup = setupTestEnv();
    // Count existing projects to make tests independent of current state
    const pm = createProjectManager();
    initialProjectCount = pm.listProjects().length;
  });

  afterEach(() => {
    cleanup();
  });

  describe("createProjectManager", () => {
    test("creates a project manager instance", () => {
      const pm = createProjectManager();
      expect(pm).toBeDefined();
      expect(pm.listProjects).toBeInstanceOf(Function);
      expect(pm.createProject).toBeInstanceOf(Function);
      expect(pm.loadProject).toBeInstanceOf(Function);
    });
  });

  describe("listProjects", () => {
    test("returns array of existing projects", () => {
      const pm = createProjectManager();
      const projects = pm.listProjects();
      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBe(initialProjectCount);
    });
  });

  describe("createProject", () => {
    test("creates a new project with valid inputs", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "my-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("TestProject");
      const project = pm.createProject(name, "A test project description", projectPath);

      expect(project.name).toBe(name);
      expect(project.description).toBe("A test project description");
      expect(project.path).toBe(projectPath);
      expect(project.id).toBeDefined();
      expect(project.createdAt).toBeDefined();

      // Cleanup: remove from index
      pm.deleteProject(project.id);
    });

    test("creates .conclave directory structure", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "structured-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("StructuredProject");
      const project = pm.createProject(name, "Testing structure", projectPath);

      expect(existsSync(join(projectPath, ".conclave"))).toBe(true);
      expect(existsSync(join(projectPath, ".conclave", "planning"))).toBe(true);
      expect(existsSync(join(projectPath, ".conclave", "memory"))).toBe(true);
      expect(existsSync(join(projectPath, ".conclave", "CLAUDE.md"))).toBe(true);

      pm.deleteProject(project.id);
    });

    test("generates CLAUDE.md with project info", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "claude-md-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("ClaudeMDProject");
      const project = pm.createProject(name, "Project with CLAUDE.md", projectPath);

      const claudeMdPath = join(projectPath, ".conclave", "CLAUDE.md");
      const content = readFileSync(claudeMdPath, "utf-8");

      expect(content).toContain(`# ${name}`);
      expect(content).toContain("Project with CLAUDE.md");

      pm.deleteProject(project.id);
    });

    test("persists project to index file", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "indexed-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("IndexedProject");
      const created = pm.createProject(name, "Will be indexed", projectPath);
      const listed = pm.listProjects();

      expect(listed.length).toBe(initialProjectCount + 1);
      const found = listed.find((p) => p.id === created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe(name);

      pm.deleteProject(created.id);
    });

    test("throws when directory does not exist", () => {
      const pm = createProjectManager();
      const nonExistentPath = join(TEST_DIR, "does-not-exist");

      expect(() => {
        pm.createProject(uniqueName("BadProject"), "No directory", nonExistentPath);
      }).toThrow("does not exist");
    });

    test("throws when project name already exists", () => {
      const pm = createProjectManager();
      const path1 = join(TEST_DIR, "project-1");
      const path2 = join(TEST_DIR, "project-2");
      mkdirSync(path1, { recursive: true });
      mkdirSync(path2, { recursive: true });

      const duplicateName = uniqueName("DuplicateName");
      const first = pm.createProject(duplicateName, "First project", path1);

      expect(() => {
        pm.createProject(duplicateName, "Second project", path2);
      }).toThrow("already exists");

      pm.deleteProject(first.id);
    });
  });

  describe("openDirectory", () => {
    test("opens an existing Conclave project", () => {
      const pm = createProjectManager();

      // First create a project
      const projectPath = join(TEST_DIR, "openable-project");
      mkdirSync(projectPath, { recursive: true });
      const name = uniqueName("Openable");
      const created = pm.createProject(name, "Can be opened", projectPath);

      // Create a fresh project manager (simulating restart)
      const pm2 = createProjectManager();

      // Since project already exists in index, openDirectory returns it
      const opened = pm2.openDirectory(projectPath);
      expect(opened.name).toBe(name);

      pm2.deleteProject(created.id);
    });

    test("throws when directory has no .conclave folder", () => {
      const pm = createProjectManager();
      const plainDir = join(TEST_DIR, "plain-directory");
      mkdirSync(plainDir, { recursive: true });

      expect(() => {
        pm.openDirectory(plainDir);
      }).toThrow("not a Conclave project");
    });

    test("throws when directory does not exist", () => {
      const pm = createProjectManager();
      const nonExistent = join(TEST_DIR, "ghost-directory");

      expect(() => {
        pm.openDirectory(nonExistent);
      }).toThrow("does not exist");
    });
  });

  describe("loadProject", () => {
    test("loads an existing project by ID", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "loadable-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("Loadable");
      const created = pm.createProject(name, "Can load by ID", projectPath);
      const loaded = pm.loadProject(created.id);

      expect(loaded.id).toBe(created.id);
      expect(loaded.name).toBe(name);
      expect(loaded.path).toBe(projectPath);

      pm.deleteProject(created.id);
    });

    test("throws when project ID not found", () => {
      const pm = createProjectManager();

      expect(() => {
        pm.loadProject("nonexistent-id");
      }).toThrow("not found");
    });

    test("throws when project directory was deleted", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "deleted-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("ToDelete");
      const created = pm.createProject(name, "Will be deleted", projectPath);
      rmSync(projectPath, { recursive: true, force: true });

      expect(() => {
        pm.loadProject(created.id);
      }).toThrow("does not exist on disk");

      // Can't delete since directory is gone, but entry exists - clean up index manually
      // Actually deleteProject should work since it only removes from index
      pm.deleteProject(created.id);
    });
  });

  describe("deleteProject", () => {
    test("removes project from index", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "deletable-project");
      mkdirSync(projectPath, { recursive: true });

      const countBefore = pm.listProjects().length;
      const name = uniqueName("Deletable");
      const created = pm.createProject(name, "Will be removed", projectPath);
      expect(pm.listProjects().length).toBe(countBefore + 1);

      pm.deleteProject(created.id);
      expect(pm.listProjects().length).toBe(countBefore);
    });

    test("does not delete actual directory (non-destructive)", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "preserved-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("Preserved");
      const created = pm.createProject(name, "Directory stays", projectPath);
      pm.deleteProject(created.id);

      expect(existsSync(projectPath)).toBe(true);
      expect(existsSync(join(projectPath, ".conclave"))).toBe(true);
    });

    test("throws when project ID not found", () => {
      const pm = createProjectManager();

      expect(() => {
        pm.deleteProject("fake-id");
      }).toThrow("not found");
    });
  });

  describe("getProjectPath", () => {
    test("returns the project path", () => {
      const pm = createProjectManager();
      const projectPath = join(TEST_DIR, "path-project");
      mkdirSync(projectPath, { recursive: true });

      const name = uniqueName("PathProject");
      const created = pm.createProject(name, "Has a path", projectPath);
      const path = pm.getProjectPath(created);

      expect(path).toBe(projectPath);

      pm.deleteProject(created.id);
    });
  });
});
