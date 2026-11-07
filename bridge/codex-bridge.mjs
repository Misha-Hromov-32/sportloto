#!/usr/bin/env node
/**
 * Мост помощника «Спорт и точка»: держит WebSocket-соединение с сайтом, отвечает на вопросы
 * чата и рисует обложки встреч через Codex CLI на этом компьютере.
 *
 * Запуск: node codex-bridge.mjs [--config config.json] [--once "вопрос"] [--image "описание обложки"]
 * Настройки — config.json рядом (образец config.example.json) или переменные окружения
 * BRIDGE_SERVER, BRIDGE_KEY, BRIDGE_NAME, CODEX_PATH, CODEX_MODEL.
 * Протокол описан в backend/app/assistant/bridge.py.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, appendFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.1';
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------- Настройки ----------

function loadConfig() {
  const file = resolve(argValue('--config') ?? join(HERE, 'config.json'));
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const env = process.env;
  const config = {
    server: env.BRIDGE_SERVER ?? fromFile.server ?? 'wss://sport.up-point.tech/api/assistant/bridge',
    key: env.BRIDGE_KEY ?? fromFile.key ?? '',
    name: env.BRIDGE_NAME ?? fromFile.name ?? hostname(),
    codexPath: env.CODEX_PATH ?? fromFile.codexPath ?? '',
    model: env.CODEX_MODEL ?? fromFile.model ?? '',
    reasoningEffort: fromFile.reasoningEffort ?? 'low',
    concurrency: Math.max(1, Number(fromFile.concurrency ?? 2)),
    logFile: fromFile.logFile ?? join(HERE, 'logs', 'bridge.log'),
  };
  config.codexPath ||= findCodex();
  return config;
}

/** Codex CLI: в PATH, в приложении Codex для Windows или в ~/.codex. Берём самый свежий. */
function findCodex() {
  const candidates = [];
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const bin = join(local, 'OpenAI', 'Codex', 'bin');
    if (existsSync(bin))
      for (const dir of readdirSync(bin)) candidates.push(join(bin, dir, 'codex.exe'));
  }
  candidates.push(join(home, '.codex', '.sandbox-bin', 'codex.exe'));
  const found = candidates
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? (process.platform === 'win32' ? 'codex.cmd' : 'codex');
}

// ---------- Журнал ----------

let config;
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(dirname(config.logFile), { recursive: true });
    if (existsSync(config.logFile) && statSync(config.logFile).size > 5 * 1024 * 1024)
      renameSync(config.logFile, `${config.logFile}.1`);
    appendFileSync(config.logFile, line + '\n');
  } catch {
    // журнал не обязателен
  }
}

// ---------- Codex ----------

/** Один вопрос: Codex без доступа к файлам и командам, ответ строго по JSON-схеме. */
function askCodex(prompt, schema, timeoutSeconds) {
  return new Promise((resolvePromise, reject) => {
    const work = mkdtempSync(join(tmpdir(), 'sport-bridge-'));
    const schemaFile = join(work, 'schema.json');
    const outFile = join(work, 'answer.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    const codexArgs = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--cd',
      work,
      '--output-schema',
      schemaFile,
      '--output-last-message',
      outFile,
      '-c',
      `model_reasoning_effort="${config.reasoningEffort}"`,
    ];
    if (config.model) codexArgs.push('--model', config.model);
    codexArgs.push('-');
    const child = spawn(config.codexPath, codexArgs, {
      cwd: work,
      windowsHide: true,
      shell: config.codexPath.endsWith('.cmd'),
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => child.kill(), Math.max(5, timeoutSeconds - 2) * 1000);
    const cleanup = () => {
      clearTimeout(timer);
      rmSync(work, { recursive: true, force: true });
    };
    child.on('error', (error) => {
      cleanup();
      reject(new Error(`Не удалось запустить Codex: ${error.message}`));
    });
    child.on('close', (code) => {
      try {
        const answer = existsSync(outFile) ? readFileSync(outFile, 'utf8').trim() : '';
        if (code === 0 && answer) resolvePromise(answer);
        else reject(new Error(`Codex завершился с кодом ${code}: ${stderr.split('\n').slice(-3).join(' ')}`));
      } finally {
        cleanup();
      }
    });
    child.stdin.end(prompt);
  });
}

/**
 * Обложка: Codex рисует картинку встроенным инструментом и кладёт cover.png в свежую пустую
 * временную папку (запись только в неё, без доступа к остальным файлам и без сети для команд).
 * Читаем только этот файл, проверяем, что это PNG разумного размера, и удаляем папку.
 * Встроенный инструмент сам сохраняет картинку в generated_images/<id сессии>/ папки Codex,
 * а скопировать её в cover.png модель иногда забывает: тогда берём файл оттуда.
 */
function generatedImage(sessionLog) {
  const id = /session id:\s*([0-9a-f-]{36})/i.exec(sessionLog)?.[1];
  if (!id) return null;
  const dir = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images', id);
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ?? null;
}

function generateImage(prompt, timeoutSeconds) {
  return new Promise((resolvePromise, reject) => {
    const work = mkdtempSync(join(tmpdir(), 'sport-bridge-image-'));
    const target = join(work, 'cover.png');
    const codexArgs = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '--cd',
      work,
      '-c',
      'model_reasoning_effort="low"',
    ];
    if (config.model) codexArgs.push('--model', config.model);
    codexArgs.push('-');
    const child = spawn(config.codexPath, codexArgs, {
      cwd: work,
      windowsHide: true,
      shell: config.codexPath.endsWith('.cmd'),
    });
    let stderr = '';
    let header = '';
    child.stderr.on('data', (chunk) => {
      if (header.length < 4000) header += chunk;
      stderr = (stderr + chunk).slice(-4000);
    });
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => child.kill(), Math.max(10, timeoutSeconds - 5) * 1000);
    const cleanup = () => {
      clearTimeout(timer);
      rmSync(work, { recursive: true, force: true });
    };
    child.on('error', (error) => {
      cleanup();
      reject(new Error(`Не удалось запустить Codex: ${error.message}`));
    });
    child.on('close', (code) => {
      try {
        const file = existsSync(target) ? target : generatedImage(header);
        if (!file) {
          reject(new Error(`Codex не сохранил картинку (код ${code}): ${stderr.split('\n').slice(-3).join(' ')}`));
          return;
        }
        const size = statSync(file).size;
        const image = readFileSync(file);
        if (size > IMAGE_MAX_BYTES || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
          reject(new Error('Картинка не PNG или больше 8 МБ'));
          return;
        }
        resolvePromise(image);
      } finally {
        cleanup();
      }
    });
    child.stdin.end(prompt);
  });
}

// ---------- Соединение с сайтом ----------

let active = 0;
const queue = [];

function pump(send) {
  while (active < config.concurrency && queue.length) {
    const job = queue.shift();
    active++;
    const started = Date.now();
    const work =
      job.task === 'image'
        ? generateImage(job.prompt, job.timeoutSeconds ?? 170).then(
            (png) => `data:image/png;base64,${png.toString('base64')}`,
          )
        : askCodex(job.prompt, job.schema, job.timeoutSeconds ?? 45);
    work
      .then((content) => {
        log(`ответ ${job.id.slice(0, 8)} за ${Date.now() - started} мс`);
        send({ type: 'response', id: job.id, ok: true, content });
      })
      .catch((error) => {
        log(`ошибка ${job.id.slice(0, 8)}: ${error.message}`);
        send({ type: 'response', id: job.id, ok: false, error: error.message.slice(0, 300) });
      })
      .finally(() => {
        active--;
        pump(send);
      });
  }
}

function connect(attempt = 0) {
  const ws = new WebSocket(config.server);
  const started = Date.now();
  let alive = started;
  let finished = false;
  const send = (message) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  // Переподключение ровно один раз: по событию close или по сторожу, если close так и не пришёл
  // (после перезапуска сервера соединение может повиснуть в состоянии «подключаюсь»).
  const retry = (reason, wait) => {
    if (finished) return;
    finished = true;
    clearInterval(watchdog);
    try {
      ws.close();
    } catch {
      // уже закрыто
    }
    log(`соединение закрыто (${reason}), повтор через ${Math.round(wait / 1000)} с`);
    setTimeout(() => connect(attempt + 1), wait);
  };
  const backoff = () => Math.min(30_000, 1_000 * 2 ** attempt);
  const watchdog = setInterval(() => {
    // Сервер шлёт ping раз в 20 секунд: тишина больше минуты — соединение потеряно.
    const stuck = ws.readyState === WebSocket.CONNECTING && Date.now() - started > 20_000;
    if (stuck || Date.now() - alive > 65_000) retry(stuck ? 'не подключилось' : 'нет ответа', backoff());
    else send({ type: 'ping' });
  }, 10_000);

  ws.addEventListener('open', () => {
    send({ type: 'hello', key: config.key, name: config.name, engine: 'codex', version: VERSION });
  });
  ws.addEventListener('message', (event) => {
    alive = Date.now();
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === 'ready') {
      attempt = 0;
      log(`подключён к ${config.server} как «${config.name}»`);
    } else if (message.type === 'error') {
      log(`сайт отказал: ${message.message}`);
    } else if (message.type === 'ping') {
      send({ type: 'pong' });
    } else if (message.type === 'request' && typeof message.id === 'string') {
      log(`${message.task === 'image' ? 'обложка' : 'вопрос'} ${message.id.slice(0, 8)}`);
      queue.push(message);
      pump(send);
    }
  });
  ws.addEventListener('close', (event) => {
    retry(String(event.code), event.code === 4401 ? 60_000 : backoff());
  });
  ws.addEventListener('error', () => {
    // подробности придут в close
  });
}

// ---------- Запуск ----------

config = loadConfig();
const once = argValue('--once');
const imageText = argValue('--image');
if (imageText) {
  // Проверка рисования из командной строки: cover.png появится рядом с мостом.
  log(`проверка рисования: ${config.codexPath}`);
  const started = Date.now();
  generateImage(
    `Только сгенерируй одно изображение встроенным инструментом генерации изображений. Сюжет: "${imageText}". ` +
      'Реалистичная фотография, горизонтальный кадр 3:2, без текста и логотипов. Сохрани результат как cover.png в текущей папке.',
    240,
  )
    .then((png) => {
      const out = join(HERE, 'cover.png');
      writeFileSync(out, png);
      console.log(`${out} (${Math.round(png.length / 1024)} КБ, ${Math.round((Date.now() - started) / 1000)} с)`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
} else if (once) {
  const schema = JSON.parse(readFileSync(join(HERE, 'reply.schema.json'), 'utf8'));
  log(`проверка Codex: ${config.codexPath}`);
  askCodex(`Ответь по-русски одним предложением. Вопрос: ${once}`, schema, 120)
    .then((answer) => {
      console.log(answer);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
} else {
  if (!config.key) {
    console.error('Не задан ключ моста. Выпустите его в админке: Помощник → «Выпустить ключ моста».');
    process.exit(2);
  }
  if (typeof WebSocket === 'undefined') {
    console.error('Нужен Node.js 22 или новее.');
    process.exit(2);
  }
  log(`мост ${VERSION}, Codex: ${config.codexPath}`);
  connect();
}
