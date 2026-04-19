import {
	type AtlasDocMetadataProfile,
	BUILT_IN_DOC_METADATA_PROFILES,
	type DocumentMetadataFilters,
} from "@atlas/core";

export function appendMetadataFilterSql(
	filters: DocumentMetadataFilters | undefined,
	columnPrefix: string,
	clauses: string[],
	params: Record<string, string | number>,
): void {
	if (!filters) return;
	const profiles: Record<string, AtlasDocMetadataProfile> =
		BUILT_IN_DOC_METADATA_PROFILES;
	const profile =
		filters.profile === undefined ? undefined : profiles[filters.profile];
	const visibility = filters.visibility ?? profile?.visibility;
	const audience = filters.audience ?? profile?.audience;
	const purpose = filters.purpose ?? profile?.purpose;
	if (visibility && visibility.length > 0) {
		clauses.push(
			`${columnPrefix}visibility IN (${visibility.map((_, index) => `$visibility${index}`).join(", ")})`,
		);
		visibility.forEach((value, index) => {
			params[`$visibility${index}`] = value;
		});
	}
	if (audience && audience.length > 0) {
		clauses.push(
			`(${audience.map((_, index) => `${columnPrefix}audience_json LIKE $audience${index}`).join(" OR ")})`,
		);
		audience.forEach((value, index) => {
			params[`$audience${index}`] = `%"${value}"%`;
		});
	}
	if (purpose && purpose.length > 0) {
		clauses.push(
			`(${purpose.map((_, index) => `${columnPrefix}purpose_json LIKE $purpose${index}`).join(" OR ")})`,
		);
		purpose.forEach((value, index) => {
			params[`$purpose${index}`] = `%"${value}"%`;
		});
	}
}
