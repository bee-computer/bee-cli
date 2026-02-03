import nacl from "tweetnacl";

const APP_PAIRING_ENCRYPTION_VERSION = 1;
const APP_PAIRING_NONCE_SIZE = 24;
const APP_PAIRING_PUBLIC_KEY_SIZE = 32;

export type AppPairingKeyPair = {
  publicKeyBase64: string;
  publicKeyBytes: Uint8Array;
  secretKey: Uint8Array;
};

export function generateAppPairingKeyPair(): AppPairingKeyPair {
  const keyPair = nacl.box.keyPair();
  const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");
  return {
    publicKeyBase64,
    publicKeyBytes: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
}

export function decryptAppPairingToken(
  encryptedTokenBase64: string,
  secretKey: Uint8Array
): string {
  const packed = Buffer.from(encryptedTokenBase64, "base64");
  const minimumSize =
    1 + APP_PAIRING_NONCE_SIZE + APP_PAIRING_PUBLIC_KEY_SIZE + 16;
  if (packed.length < minimumSize) {
    throw new Error("Invalid response from developer API.");
  }

  const version = packed[0];
  if (version !== APP_PAIRING_ENCRYPTION_VERSION) {
    throw new Error("Unsupported pairing payload version.");
  }

  const nonceStart = 1;
  const nonceEnd = nonceStart + APP_PAIRING_NONCE_SIZE;
  const publicKeyStart = nonceEnd;
  const publicKeyEnd = publicKeyStart + APP_PAIRING_PUBLIC_KEY_SIZE;

  const nonce = packed.subarray(nonceStart, nonceEnd);
  const ephemeralPublicKey = packed.subarray(publicKeyStart, publicKeyEnd);
  const ciphertext = packed.subarray(publicKeyEnd);

  const opened = nacl.box.open(
    ciphertext,
    nonce,
    ephemeralPublicKey,
    secretKey
  );
  if (!opened) {
    throw new Error("Invalid response from developer API.");
  }

  const token = Buffer.from(opened).toString("utf8").trim();
  if (!token) {
    throw new Error("Invalid response from developer API.");
  }

  return token;
}
