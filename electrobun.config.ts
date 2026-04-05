import type { ElectrobunConfig } from "electrobun";
import { resolve } from "path";
import { existsSync } from "fs";

const pathAliasPlugin: import("bun").BunPlugin = {
	name: "path-alias",
	setup(build) {
		build.onResolve({ filter: /^@\// }, (args) => {
			const base = resolve(import.meta.dir, "src", args.path.slice(2));
			for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
				const candidate = base + ext;
				if (existsSync(candidate)) {
					return { path: candidate };
				}
			}
			return { path: base };
		});
	},
};

export default {
	app: {
		name: "conclave",
		identifier: "conclave.denizlg24.com",
		version: "0.1.0",
	},
	build: {
		bun: {
			plugins: [pathAliasPlugin],
		},
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
