import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '../../../common/config/env';

/**
 * أسرار التحقق الثنائي مشفّرة في القاعدة — العمود اسمه totpSecretEnc وكان
 * يحمل السرّ نصّاً، فمن قرأ القاعدة ولّد رموز كل حساب.
 *
 * AES-256-GCM بمفتاح من البيئة (TOTP_ENCRYPTION_KEY)، ومتّجه جديد لكل تشفير،
 * ومعرّف المستخدم بيانات مصاحبة (AAD): نصّ مشفّر نُقل إلى صفّ حساب آخر لا يُفكّ.
 *
 * الصيغة: v1.<iv>.<tag>.<ciphertext> بـ base64url. قيمة بلا البادئة سرّ قديم
 * كُتب نصّاً قبل هذا — يُقرأ كما هو ويُشفَّر عند أول استعمال ناجح، وسكربت
 * totp:seal يشفّر ما بقي منها دفعة واحدة.
 */
const VERSION = 'v1';
const BASE32 = /^[A-Z2-7]+=*$/;

const b64 = (b: Buffer) => b.toString('base64url');

export function sealTotpSecret(secret: string, userId: string, key: Buffer = loadEnv().totpKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join('.');
}

/** السرّ الصريح من المخزَّن. يرمي على نصّ عُبث به أو مفتاح خاطئ أو حساب آخر */
export function openTotpSecret(stored: string, userId: string, key: Buffer = loadEnv().totpKey): string {
  if (isLegacyPlain(stored)) return stored;
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('صيغة سرّ التحقق غير معروفة.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

/** سرّ كُتب نصّاً قبل التشفير — base32 كما يولّده otplib */
export const isLegacyPlain = (stored: string): boolean => BASE32.test(stored);
