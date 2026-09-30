#!/usr/bin/env node
// تشفير النسخ الاحتياطية — بمفتاح عام، فالجهاز الذي يأخذ النسخة لا يستطيع قراءتها.
//
// كانت النسخة ملفّ pg_dump مكشوفاً في .localdb/backups داخل مجلد يزامنه OneDrive:
// كل حساب وعنوان وطلب وقيد في الدفتر، في سحابة طرف ثالث، بنصّه. الآن:
//
//   المفتاح العام (backup-key.pub) يبقى على الجهاز ويكفي للتشفير وحده.
//   المفتاح الخاص (backup-key.pem) خارج المشروع وخارج OneDrive — ونسخة منه خارج الجهاز
//   (مدير كلمات المرور). النسخ المشفّرة نفسها يصحّ أن تزامنها السحابة: نسخة خارج الموقع.
//
// الصيغة: BASTABK1 | بصمة المفتاح (8) | مفتاح عابر X25519 (32) | iv (12) | النصّ المشفَّر | وسم GCM (16)
// المفتاح المتماثل = HKDF-SHA256 على سرّ X25519 المشترك؛ الترويسة كلها بيانات مصادَق عليها،
// فأيّ بايت يتغيّر — في الترويسة أو المحتوى — يُسقط فكّ التشفير ولا يُكتب منه شيء.
//
//   node backup-crypt.mjs keygen <خاص.pem> <عام.pub>
//   node backup-crypt.mjs seal <عام.pub> <دخل|-> <خرج>
//   node backup-crypt.mjs open <خاص.pem> <دخل> <خرج>
//   node backup-crypt.mjs is-sealed <ملف>        رمز خروج 0 إن كان مشفّراً بهذه الصيغة

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('BASTABK1', 'ascii');
const KEY_ID = 8;
const EPH = 32;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + KEY_ID + EPH + IV;
const INFO = Buffer.from('basta-backup/v1', 'ascii');
// SPKI لمفتاح X25519 = هذه البادئة + 32 بايتاً خاماً
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function die(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

const rawOf = (publicKey) => publicKey.export({ type: 'spki', format: 'der' }).subarray(X25519_SPKI_PREFIX.length);
const publicFromRaw = (raw) => createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
const keyIdOf = (raw) => createHash('sha256').update(raw).digest().subarray(0, KEY_ID);

function symmetricKey(shared, ephRaw, recipientRaw) {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephRaw, recipientRaw]), INFO, 32));
}

function readKey(path, kind) {
  if (!existsSync(path)) die(`المفتاح ${kind === 'public' ? 'العام' : 'الخاص'} غير موجود: ${path}`);
  const pem = readFileSync(path);
  const key = kind === 'public' ? createPublicKey(pem) : createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'x25519') die(`${path} ليس مفتاح X25519`);
  return key;
}

function keygen(privPath, pubPath) {
  // مفتاح خاص قائم يفكّ نسخاً قائمة — الكتابة فوقه تجعلها كلها غير قابلة للاستعادة
  if (existsSync(privPath)) die(`يوجد مفتاح خاص في ${privPath} — لن يُكتب فوقه. انقله أو احذفه بنفسك إن كنت متأكداً`);
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  mkdirSync(dirname(privPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(pubPath), { recursive: true });
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  process.stdout.write(`${keyIdOf(rawOf(publicKey)).toString('hex')}\n`);
}

async function seal(pubPath, inPath, outPath) {
  const recipient = readKey(pubPath, 'public');
  const recipientRaw = rawOf(recipient);
  const eph = generateKeyPairSync('x25519');
  const ephRaw = rawOf(eph.publicKey);
  const key = symmetricKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephRaw, recipientRaw);
  const iv = randomBytes(IV);
  const header = Buffer.concat([MAGIC, keyIdOf(recipientRaw), ephRaw, iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(header);

  // يُكتب إلى .part ثم يُعاد تسميته: نسخة مبتورة (امتلأ القرص، سقط pg_dump) لا تحمل اسم نسخة
  const part = `${outPath}.part`;
  try {
    await pipeline(
      inPath === '-' ? process.stdin : createReadStream(inPath),
      cipher,
      async function* (body) {
        yield header;
        for await (const chunk of body) yield chunk;
        yield cipher.getAuthTag();
      },
      createWriteStream(part, { mode: 0o600 }),
    );
    renameSync(part, outPath);
  } catch (err) {
    rmSync(part, { force: true });
    die(`فشل التشفير: ${err.message}`);
  }
}

function readHeader(inPath) {
  const size = statSync(inPath).size;
  if (size < HEADER + TAG) return null;
  const fd = openSync(inPath, 'r');
  try {
    const header = Buffer.alloc(HEADER);
    readSync(fd, header, 0, HEADER, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) return null;
    const tag = Buffer.alloc(TAG);
    readSync(fd, tag, 0, TAG, size - TAG);
    return { size, header, tag };
  } finally {
    closeSync(fd);
  }
}

async function open(privPath, inPath, outPath) {
  const privateKey = readKey(privPath, 'private');
  const recipientRaw = rawOf(createPublicKey(privateKey));
  const parsed = readHeader(inPath);
  if (!parsed) die(`${inPath} ليس نسخة مشفّرة بهذه الصيغة`);
  const { size, header, tag } = parsed;

  let at = MAGIC.length;
  const keyId = header.subarray(at, (at += KEY_ID));
  const ephRaw = header.subarray(at, (at += EPH));
  const iv = header.subarray(at, (at += IV));
  if (!keyId.equals(keyIdOf(recipientRaw))) {
    die(`النسخة مشفّرة لمفتاح آخر (${keyId.toString('hex')})؛ هذا المفتاح ${keyIdOf(recipientRaw).toString('hex')}`);
  }

  const key = symmetricKey(diffieHellman({ privateKey, publicKey: publicFromRaw(ephRaw) }), ephRaw, recipientRaw);
  const decipher = createDecipheriv('aes-256-gcm', key, iv).setAAD(header);
  decipher.setAuthTag(tag);

  // الوسم يُتحقَّق منه في النهاية — فالخرج يبقى .part حتى يصحّ، ويُحذف إن لم يصحّ
  const part = `${outPath}.part`;
  try {
    await pipeline(createReadStream(inPath, { start: HEADER, end: size - TAG - 1 }), decipher, createWriteStream(part, { mode: 0o600 }));
    renameSync(part, outPath);
  } catch {
    rmSync(part, { force: true });
    die(`${inPath}: فكّ التشفير فشل — الملف معدَّل أو مبتور`);
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'keygen':
    if (args.length !== 2) die('keygen <خاص.pem> <عام.pub>');
    keygen(...args);
    break;
  case 'seal':
    if (args.length !== 3) die('seal <عام.pub> <دخل|-> <خرج>');
    await seal(...args);
    break;
  case 'open':
    if (args.length !== 3) die('open <خاص.pem> <دخل> <خرج>');
    await open(...args);
    break;
  case 'is-sealed':
    if (args.length !== 1) die('is-sealed <ملف>');
    process.exit(readHeader(args[0]) ? 0 : 1);
    break;
  default:
    die('الاستعمال: keygen | seal | open | is-sealed');
}
