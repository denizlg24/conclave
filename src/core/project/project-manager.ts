import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ProjectMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly createdAt: string;
}

interface ProjectIndex {
  projects: ProjectMeta[];
}

const CONCLAVE_HOME = join(homedir(), ".conclave");
const INDEX_PATH = join(CONCLAVE_HOME, "projects.json");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readIndex(): ProjectIndex {
  ensureDir(CONCLAVE_HOME);
  if (!existsSync(INDEX_PATH)) {
    return { projects: [] };
  }
  const raw = readFileSync(INDEX_PATH, "utf-8");
  return JSON.parse(raw) as ProjectIndex;
}

function writeIndex(index: ProjectIndex): void {
  ensureDir(CONCLAVE_HOME);
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

export interface ProjectManagerShape {
  readonly listProjects: () => ProjectMeta[];
  readonly createProject: (name: string, description: string, path: string) => ProjectMeta;
  readonly openDirectory: (path: string) => ProjectMeta;
  readonly loadProject: (id: string) => ProjectMeta;
  readonly deleteProject: (id: string) => void;
  readonly getProjectPath: (project: ProjectMeta) => string;
}

export function createProjectManager(): ProjectManagerShape {
  const listProjects = (): ProjectMeta[] => {
    return readIndex().projects;
  };

  const createProject = (name: string, description: string, path: string): ProjectMeta => {
    const index = readIndex();

    const duplicate = index.projects.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new Error(`Project with name "${name}" already exists.`);
    }

    if (!existsSync(path)) {
      throw new Error(`Directory "${path}" does not exist.`);
    }

    const id = crypto.randomUUID();

    // Create .conclave metadata inside the chosen directory
    ensureDir(join(path, ".conclave"));
    ensureDir(join(path, ".conclave", "planning"));
    ensureDir(join(path, ".conclave", "memory"));

    // Write a CLAUDE.md so agents have project context on resume
    const claudeMdPath = join(path, ".conclave", "CLAUDE.md");
    if (!existsSync(claudeMdPath)) {
      const claudeMd = [
        `# ${name}`,
        "",
        description,
        "",
        "---",
        "",
        "This project is managed by the Conclave orchestration platform.",
        "",
        "## Directory Structure",
        "- `.conclave/planning/` — PM planning documents and task decomposition notes",
        "- `.conclave/memory/` — Agent memory and decision logs",
        "",
      ].join("\n");
      writeFileSync(claudeMdPath, claudeMd, "utf-8");
    }

    const project: ProjectMeta = {
      id,
      name,
      description,
      path,
      createdAt: new Date().toISOString(),
    };

    index.projects.push(project);
    writeIndex(index);

    return project;
  };

  const openDirectory = (path: string): ProjectMeta => {
    if (!existsSync(path)) {
      throw new Error(`Directory "${path}" does not exist.`);
    }

    const index = readIndex();

    // Already registered — return it
    const existing = index.projects.find((p) => p.path === path);
    if (existing) return existing;

    // Has .conclave/ metadata — register it
    const conclaveDir = join(path, ".conclave");
    if (!existsSync(conclaveDir)) {
      throw new Error(
        `Directory "${path}" is not a Conclave project (no .conclave/ found). Use "Create Project" instead.`,
      );
    }

    // Try to read project name from .conclave/CLAUDE.md header
    const claudeMdPath = join(conclaveDir, "CLAUDE.md");
    let name = path.split(/[\\/]/).pop() ?? "Unnamed";
    let description = "";
    if (existsSync(claudeMdPath)) {
      const content = readFileSync(claudeMdPath, "utf-8");
      const headerMatch = content.match(/^#\s+(.+)$/m);
      if (headerMatch) name = headerMatch[1];
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
      if (lines.length > 0) description = lines[0].trim();
    }

    const project: ProjectMeta = {
      id: crypto.randomUUID(),
      name,
      description,
      path,
      createdAt: new Date().toISOString(),
    };

    index.projects.push(project);
    writeIndex(index);

    return project;
  };

  const loadProject = (id: string): ProjectMeta => {
    const index = readIndex();
    const project = index.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error(`Project "${id}" not found.`);
    }
    if (!existsSync(project.path)) {
      throw new Error(
        `Project directory "${project.path}" does not exist on disk.`,
      );
    }
    return project;
  };

  const deleteProject = (id: string): void => {
    const index = readIndex();
    const idx = index.projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Project "${id}" not found.`);
    }
    index.projects.splice(idx, 1);
    writeIndex(index);
    // Note: we don't delete the directory — that's destructive and should be manual
  };

  const getProjectPath = (project: ProjectMeta): string => project.path;

  return {
    listProjects,
    createProject,
    openDirectory,
    loadProject,
    deleteProject,
    getProjectPath,
  };
}
