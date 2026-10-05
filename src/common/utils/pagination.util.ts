type PaginationInput = {
  page: number;
  limit: number;
};

export function createPaginationMeta(
  pagination: PaginationInput,
  total: number,
) {
  const { page, limit } = pagination;

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
