// Accept the existing major tags and exact patch pins, with a required image variant.
// A digest, when present, must be a complete SHA-256 pin.
export const NODE_MAJOR = 26;

const NODE_IMAGE_TAG = new RegExp(
  String.raw`^${NODE_MAJOR}(?:\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))?-[a-z0-9][a-z0-9._-]*(?:@sha256:[a-f0-9]{64})?$`,
);

export function isNodeImageTag(tag) {
  return NODE_IMAGE_TAG.test(tag);
}
