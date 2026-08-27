// No-op code-signing script for electron-builder.
// We don't ship signed binaries in dev/test builds, so this tells electron-builder
// to skip the winCodeSign toolchain entirely (which otherwise fails to extract on
// machines without symlink privileges). For real signing, replace this with a proper
// sign implementation or remove the `win.sign` config key.
module.exports = async function noopSign(configuration) {
  return configuration.path;
};
