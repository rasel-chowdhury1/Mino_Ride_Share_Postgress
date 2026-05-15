
type SortOrder = 'asc' | 'desc';

export interface PrismaQueryArgs {
  where:   Record<string, unknown>;
  orderBy: Record<string, SortOrder>;
  skip:    number;
  take:    number;
}

class QueryBuilder {
  private _where:   Record<string, unknown>;
  private _orderBy: Record<string, SortOrder> = { createdAt: 'desc' };
  private _skip   = 0;
  private _take   = 10;
  private _page   = 1;
  private _limit  = 10;

  constructor(
    baseWhere: Record<string, unknown>,
    private query: Record<string, unknown>,
  ) {
    this._where = { ...baseWhere };
  }

  search(searchableFields: string[]) {
    const searchTerm = this.query.searchTerm as string | undefined;
    if (searchTerm) {
      this._where.OR = searchableFields.map((f) => ({
        [f]: { contains: searchTerm, mode: 'insensitive' },
      }));
    }
    return this;
  }

  filter() {
    const exclude = new Set(['searchTerm', 'sort', 'limit', 'page', 'fields', 'minPrice', 'maxPrice']);
    for (const [k, v] of Object.entries(this.query)) {
      if (!exclude.has(k) && v !== undefined && v !== '') {
        this._where[k] = v;
      }
    }

    const minPrice = this.query.minPrice !== undefined ? parseFloat(this.query.minPrice as string) : NaN;
    const maxPrice = this.query.maxPrice !== undefined ? parseFloat(this.query.maxPrice as string) : NaN;
    if (!isNaN(minPrice) || !isNaN(maxPrice)) {
      const price: Record<string, number> = {};
      if (!isNaN(minPrice)) price.gte = minPrice;
      if (!isNaN(maxPrice)) price.lte = maxPrice;
      this._where.price = price;
    }

    return this;
  }

  sort() {
    const sortParam = (this.query.sort as string | undefined) ?? '-createdAt';
    const field     = sortParam.startsWith('-') ? sortParam.slice(1) : sortParam;
    const dir       = sortParam.startsWith('-') ? 'desc' : 'asc';
    this._orderBy   = { [field]: dir };
    return this;
  }

  paginate() {
    this._page   = Math.max(1, Number(this.query.page)  || 1);
    this._limit  = Math.max(1, Number(this.query.limit) || 10);
    this._skip   = (this._page - 1) * this._limit;
    this._take   = this._limit;
    return this;
  }

  build(): PrismaQueryArgs {
    return {
      where:   this._where,
      orderBy: this._orderBy,
      skip:    this._skip,
      take:    this._take,
    };
  }

  async countTotal(countFn: (where: Record<string, unknown>) => Promise<number>) {
    const total     = await countFn(this._where);
    const totalPage = Math.ceil(total / this._limit);
    return { page: this._page, limit: this._limit, total, totalPage };
  }
}

export default QueryBuilder;
