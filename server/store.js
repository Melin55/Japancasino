import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { UserError } from "./network.js";

export class ProjectStore {
  constructor(root) {
    this.root = root;
    this.pending = new Map();
  }
  file(id) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new UserError("提案が見つかりません。", 404);
    return path.join(this.root, `${id}.json`);
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root)) {
      if (!name.endsWith(".json")) continue;
      try {
        const p = JSON.parse(
          await readFile(path.join(this.root, name), "utf8"),
        );
        if (["crawling", "researching", "building"].includes(p.status)) {
          p.status = "error";
          p.error = "処理が中断されました。調査を再開してください。";
          await this.save(p);
        }
      } catch {
        /* damaged records are never served */
      }
    }
  }
  async create(owner, data) {
    const p = {
      id: randomUUID(),
      owner,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ratings: {},
      events: [],
      ...data,
    };
    await this.save(p);
    return p;
  }
  async save(project) {
    project.updatedAt = new Date().toISOString();
    const content = JSON.stringify(project);
    const id = project.id;
    const next = (this.pending.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const file = this.file(id);
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, content, { mode: 0o600 });
        await rename(temp, file);
      });
    this.pending.set(id, next);
    await next;
    if (this.pending.get(id) === next) this.pending.delete(id);
  }
  async get(id, owner) {
    let p;
    try {
      p = JSON.parse(await readFile(this.file(id), "utf8"));
    } catch {
      throw new UserError("提案が見つかりません。", 404);
    }
    if (p.owner !== owner) throw new UserError("提案が見つかりません。", 404);
    return p;
  }
  async delete(id, owner) {
    await this.get(id, owner);
    await unlink(this.file(id));
  }
}
