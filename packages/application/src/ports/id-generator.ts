import { generateId } from "@tomokichi/domain";

export interface IdGenerator {
  next<T extends string>(): T;
}

export const uuidV7Generator: IdGenerator = { next: <T extends string>() => generateId() as T };
