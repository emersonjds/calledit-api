export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}
