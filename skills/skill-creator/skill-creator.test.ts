import { describe, expect, test } from "bun:test";

const skillPath = "skills/skill-creator/SKILL.md";
const templatePath = "skills/skill-creator/references/skill-spec-template.md";

describe("skill-creator skill", () => {
	test("keeps public metadata and approval guardrails", async () => {
		const skill = await Bun.file(skillPath).text();
		const template = await Bun.file(templatePath).text();
		const combined = `${skill}\n${template}`;

		for (const expected of [
			"name: skill-creator",
			"visibility: public",
			"contributor",
			"maintainer",
			"workflow",
		]) {
			expect(skill).toContain(expected);
		}

		for (const expected of [
			"No files may be written during research, recommendation, or discussion",
			"exact skill names",
			"exact target paths",
			"vague enthusiasm",
			"follow-up questions",
			"skills/<skill-name>/SKILL.md",
		]) {
			expect(skill).toContain(expected);
		}

		for (const expected of [
			"skill name",
			"target users",
			"trigger conditions",
			"why useful",
			"suggested files/folders",
			"confidence",
			"risks",
			"overlap with existing skills",
		]) {
			expect(combined).toContain(expected);
		}

		for (const expected of [
			"approved skill name",
			"approved target path",
			"supporting assets",
			"overwrite/update permission",
			"validation commands",
			"self-index rebuild instructions",
		]) {
			expect(combined).toContain(expected);
		}
	});
});
