import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Config } from "../src/config/Config.js";

const ORIGINAL_ENV = { ...process.env };

describe("Config skills directory", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("defaults skills.dir next to the loaded config file", () => {
		const dir = mkdtempSync(join(tmpdir(), "collector-config-"));
		try {
			const configPath = join(dir, "config.yaml");
			const config = Config.load(configPath);

			expect(config.skills.dir).toBe(join(dir, "skills"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads skills.dir from yaml", () => {
		const dir = mkdtempSync(join(tmpdir(), "collector-config-"));
		try {
			const configPath = join(dir, "config.yaml");
			writeFileSync(
				configPath,
				"skills:\n  dir: /tmp/custom-skills\n",
				"utf-8",
			);

			const config = Config.load(configPath);

			expect(config.skills.dir).toBe("/tmp/custom-skills");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("lets COLLECTOR_SKILLS_DIR override yaml", () => {
		const dir = mkdtempSync(join(tmpdir(), "collector-config-"));
		try {
			process.env.COLLECTOR_SKILLS_DIR = "/tmp/env-skills";
			const configPath = join(dir, "config.yaml");
			writeFileSync(
				configPath,
				"skills:\n  dir: /tmp/custom-skills\n",
				"utf-8",
			);

			const config = Config.load(configPath);

			expect(config.skills.dir).toBe("/tmp/env-skills");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves skills.dir to yaml", () => {
		const dir = mkdtempSync(join(tmpdir(), "collector-config-"));
		try {
			const configPath = join(dir, "config.yaml");
			new Config({
				skills: { dir: "/tmp/saved-skills", enabled: {}, env: {} },
			}).save(configPath);

			const config = Config.load(configPath);

			expect(config.skills.dir).toBe("/tmp/saved-skills");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads and saves skill enabled state and env", () => {
		const dir = mkdtempSync(join(tmpdir(), "collector-config-"));
		try {
			const configPath = join(dir, "config.yaml");
			new Config({
				skills: {
					dir: "/tmp/saved-skills",
					enabled: { "modality-pdf-parse": false },
					env: {
						"modality-pdf-parse": {
							MINERU_API_TOKEN: "mineru-token",
						},
					},
				},
			}).save(configPath);

			const config = Config.load(configPath);

			expect(config.skills.enabled["modality-pdf-parse"]).toBe(false);
			expect(config.skills.env["modality-pdf-parse"]?.MINERU_API_TOKEN).toBe(
				"mineru-token",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
