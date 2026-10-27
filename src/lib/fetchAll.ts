// Helper genérico de paginação: o Supabase retorna no máximo 1000 linhas por
// consulta, e consultas sem paginação truncam silenciosamente. O chamador monta
// a query base (filtros, colunas e ordens) e o helper apenas percorre as páginas.
//
// A ordenação do chamador deve ser determinística, sempre com desempate por
// 'id' (ex.: .order('ordem').order('id')), para que a paginação não repita nem
// pule linhas entre páginas.
// `data` é aceito como unknown[] porque o PostgrestFactory infere o tipo exato
// das colunas selecionadas; a conversão para T[] é responsabilidade do chamador.
export type PagedResult<T> = { data: T[] | unknown[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PagedResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}
