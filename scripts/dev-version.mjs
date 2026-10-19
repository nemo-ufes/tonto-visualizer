// A local build is a prerelease of the next patch: newer than the release it
// was built from, older than the release that will follow, and never the same
// twice -- the timestamp and process id tell two installs apart.
export function developmentVersion(stableVersion) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(stableVersion);

    if (!match) {
        throw new Error(`The release version must be stable SemVer before a local install; got ${stableVersion}.`);
    }

    const [, major, minor, patch] = match;
    return `${major}.${minor}.${Number(patch) + 1}-dev.${Date.now()}.${process.pid}`;
}
