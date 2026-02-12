import type { BeeCliRunner } from "@/lib/runner";

type ListOptions = {
  limit?: number;
  cursor?: string;
};

type FactsListOptions = ListOptions & {
  unconfirmed?: boolean;
};

type ChangedOptions = {
  cursor?: string;
};

type TodoCreateOptions = {
  text: string;
  alarmAt?: string;
};

type TodoUpdateOptions = {
  text?: string;
  completed?: boolean;
  alarmAt?: string;
  clearAlarm?: boolean;
};

type FactUpdateOptions = {
  text: string;
  confirmed?: boolean;
};

type SearchOptions = {
  query: string;
  limit?: number;
  since?: number;
  until?: number;
  neural?: boolean;
};

export type DataApi = {
  me: <T = unknown>() => Promise<T>;
  today: <T = unknown>() => Promise<T>;
  now: <T = unknown>() => Promise<T>;
  changed: <T = unknown>(options?: ChangedOptions) => Promise<T>;
  version: <T = unknown>() => Promise<T>;
  facts: {
    list: <T = unknown>(options?: FactsListOptions) => Promise<T>;
    get: <T = unknown>(id: string | number) => Promise<T>;
    create: <T = unknown>(text: string) => Promise<T>;
    update: <T = unknown>(id: string | number, options: FactUpdateOptions) => Promise<T>;
    delete: <T = unknown>(id: string | number) => Promise<T>;
  };
  todos: {
    list: <T = unknown>(options?: ListOptions) => Promise<T>;
    get: <T = unknown>(id: string | number) => Promise<T>;
    create: <T = unknown>(options: TodoCreateOptions) => Promise<T>;
    update: <T = unknown>(id: string | number, options: TodoUpdateOptions) => Promise<T>;
    delete: <T = unknown>(id: string | number) => Promise<T>;
  };
  conversations: {
    list: <T = unknown>(options?: ListOptions) => Promise<T>;
    get: <T = unknown>(id: string | number) => Promise<T>;
  };
  daily: {
    list: <T = unknown>(options?: ListOptions) => Promise<T>;
    get: <T = unknown>(id: string | number) => Promise<T>;
  };
  journals: {
    list: <T = unknown>(options?: ListOptions) => Promise<T>;
    get: <T = unknown>(id: string | number) => Promise<T>;
  };
  search: <T = unknown>(options: SearchOptions) => Promise<T>;
};

export function createDataApi(runner: BeeCliRunner): DataApi {
  return {
    me: () => runner.runJson(["me"]),
    today: () => runner.runJson(["today"]),
    now: () => runner.runJson(["now"]),
    changed: (options) => {
      const args = ["changed"];
      if (options?.cursor) {
        args.push("--cursor", options.cursor);
      }
      return runner.runJson(args);
    },
    version: () => runner.runJson(["version"]),
    facts: {
      list: (options) => {
        const args = ["facts", "list"];
        appendListOptions(args, options);
        if (options?.unconfirmed) {
          args.push("--unconfirmed");
        }
        return runner.runJson(args);
      },
      get: (id) => runner.runJson(["facts", "get", String(id)]),
      create: (text) => runner.runJson(["facts", "create", "--text", text]),
      update: (id, options) => {
        const args = ["facts", "update", String(id), "--text", options.text];
        if (options.confirmed !== undefined) {
          args.push("--confirmed", String(options.confirmed));
        }
        return runner.runJson(args);
      },
      delete: (id) => runner.runJson(["facts", "delete", String(id)]),
    },
    todos: {
      list: (options) => {
        const args = ["todos", "list"];
        appendListOptions(args, options);
        return runner.runJson(args);
      },
      get: (id) => runner.runJson(["todos", "get", String(id)]),
      create: (options) => {
        const args = ["todos", "create", "--text", options.text];
        if (options.alarmAt) {
          args.push("--alarm-at", options.alarmAt);
        }
        return runner.runJson(args);
      },
      update: (id, options) => {
        const args = ["todos", "update", String(id)];
        if (options.text !== undefined) {
          args.push("--text", options.text);
        }
        if (options.completed !== undefined) {
          args.push("--completed", String(options.completed));
        }
        if (options.alarmAt !== undefined) {
          args.push("--alarm-at", options.alarmAt);
        } else if (options.clearAlarm) {
          args.push("--clear-alarm");
        }
        return runner.runJson(args);
      },
      delete: (id) => runner.runJson(["todos", "delete", String(id)]),
    },
    conversations: {
      list: (options) => {
        const args = ["conversations", "list"];
        appendListOptions(args, options);
        return runner.runJson(args);
      },
      get: (id) => runner.runJson(["conversations", "get", String(id)]),
    },
    daily: {
      list: (options) => {
        const args = ["daily", "list"];
        appendListOptions(args, options);
        return runner.runJson(args);
      },
      get: (id) => runner.runJson(["daily", "get", String(id)]),
    },
    journals: {
      list: (options) => {
        const args = ["journals", "list"];
        appendListOptions(args, options);
        return runner.runJson(args);
      },
      get: (id) => runner.runJson(["journals", "get", String(id)]),
    },
    search: (options) => {
      const args = ["search", "--query", options.query];
      if (options.limit !== undefined) {
        args.push("--limit", String(options.limit));
      }
      if (options.since !== undefined) {
        args.push("--since", String(options.since));
      }
      if (options.until !== undefined) {
        args.push("--until", String(options.until));
      }
      if (options.neural) {
        args.push("--neural");
      }
      return runner.runJson(args);
    },
  };
}

function appendListOptions(args: string[], options?: ListOptions): void {
  if (options?.limit !== undefined) {
    args.push("--limit", String(options.limit));
  }
  if (options?.cursor) {
    args.push("--cursor", options.cursor);
  }
}
