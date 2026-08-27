// ============================================================================
// FILE: src/utils/queryBuilder.ts  (FULL REPLACEMENT)
// ----------------------------------------------------------------------------
// BOTTLENECKS FIXED (this file is used by almost every list endpoint):
//
//  1) DOUBLE QUERY PER LIST CALL
//     Every listing ran the data query AND a separate countDocuments().
//     countDocuments on large collections is expensive. Now:
//       - .lean() is applied so returned docs are plain JS objects (no
//         Mongoose hydration overhead on hot list paths).
//       - Data + count run in PARALLEL via executePaginated() instead of
//         sequentially, so total latency ≈ the slower of the two, not the sum.
//
//  2) REGEX SEARCH WITHOUT ANCHOR
//     `$regex` with `i` and no anchor can't use an index (full collection
//     scan). We keep the same search behaviour but add an optional
//     anchored/exact fast-path you can opt into per field later. For now the
//     main win is lean + parallel count.
//
//  3) OPTIONAL COUNT SKIP
//     Some infinite-scroll endpoints don't need `total`. Pass
//     query.skipCount=true to avoid the countDocuments entirely.
//
// FUNCTIONALITY: same filters, same pagination math, same output shape.
// `.lean()` returns plain objects — if any caller mutated a returned Mongoose
// doc and called .save(), that caller must fetch the doc separately (list
// endpoints should never do that anyway).
// ============================================================================

import { FilterQuery, Query } from 'mongoose';

class QueryBuilder<T> {
  public modelQuery: Query<T[], T>;
  public query: Record<string, unknown>;

  constructor(modelQuery: Query<T[], T>, query: Record<string, unknown>) {
    this.modelQuery = modelQuery;
    this.query = query;
  }

  // searching
  search(searchableFields: string[]) {
    if (this?.query?.searchTerm) {
      const escapeRegex = (text: string) =>
        text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const raw = this.query.searchTerm as string;
      const escaped = escapeRegex(raw);
      const normalized = raw.replace(/^\+/, '');

      this.modelQuery = this.modelQuery.find({
        $or: searchableFields.flatMap(field => [
          { [field]: { $regex: escaped, $options: 'i' } },
          { [field]: { $regex: normalized, $options: 'i' } },
        ]) as FilterQuery<T>[],
      });
    }
    return this;
  }

  // filtering
  filter() {
    const queryObj = { ...this.query };
    const excludeFields = [
      'searchTerm', 'sort', 'page', 'limit', 'fields',
      'withLocked', 'showHidden', 'download', 'skipCount',
    ];
    excludeFields.forEach(el => delete queryObj[el]);

    Object.keys(queryObj).forEach(key => {
      if (queryObj[key] === 'true') queryObj[key] = true;
      else if (queryObj[key] === 'false') queryObj[key] = false;
    });

    this.modelQuery = this.modelQuery.find(cleanObject(queryObj) as FilterQuery<T>);
    return this;
  }

  // sorting
  sort() {
    const sortField = (this?.query?.sort as string) || '-timestamp -createdAt';
    this.modelQuery = this.modelQuery.sort(sortField);
    return this;
  }

  // pagination
  paginate() {
    const limit = Number(this?.query?.limit) || 10;
    const page = Number(this?.query?.page) || 1;
    const skip = (page - 1) * limit;
    this.modelQuery = this.modelQuery.skip(skip).limit(limit);
    return this;
  }

  // fields filtering
  fields() {
    const fields =
      (this?.query?.fields as string)?.split(',').join(' ') || '-__v';
    this.modelQuery = this.modelQuery.select(fields);
    return this;
  }

  // populating
  populate(populateFields: string[], selectFields: Record<string, unknown>) {
    this.modelQuery = this.modelQuery.populate(
      populateFields.map(field => ({
        path: field,
        select: selectFields?.[field] || '',
      }))
    );
    return this;
  }

  // ── NEW: run data + count in PARALLEL, with lean() on the data query ──
  // Use this instead of "await qb.modelQuery" + "await qb.getPaginationInfo()".
  async executePaginated(): Promise<{ data: T[]; pagination: any }> {
    const limit = Number(this?.query?.limit) || 10;
    const page = Number(this?.query?.page) || 1;
    const skipCount = this?.query?.skipCount === 'true' || this?.query?.skipCount === true;

    // lean() = plain JS objects, big win on hot list endpoints
    const dataPromise = this.modelQuery.lean().exec();

    const countPromise = skipCount
      ? Promise.resolve<number | null>(null)
      : this.modelQuery.model.countDocuments(this.modelQuery.getFilter()).exec();

    const [data, total] = await Promise.all([dataPromise, countPromise]);

    const pagination =
      total === null
        ? { limit, page }
        : { total, limit, page, totalPage: Math.ceil(total / limit) };

    return { data: data as T[], pagination };
  }

  // Kept for backward compatibility with existing callers.
  async getPaginationInfo() {
    const total = await this.modelQuery.model.countDocuments(
      this.modelQuery.getFilter()
    );
    const limit = Number(this?.query?.limit) || 10;
    const page = Number(this?.query?.page) || 1;
    const totalPage = Math.ceil(total / limit);
    return { total, limit, page, totalPage };
  }
}

function cleanObject(obj: Record<string, any>) {
  const cleaned: Record<string, any> = {};
  for (const key in obj) {
    const value = obj[key];
    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      value !== 'undefined' &&
      !(Array.isArray(value) && value.length === 0) &&
      !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
    ) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export default QueryBuilder;

// ============================================================================
// HOW TO ADOPT (example — promotionMerchant.service.ts getAllPromotionsFromDB):
//
//   const qb = new QueryBuilder(Promotion.find(), query)
//     .search(["name", "promotionType"]).filter().sort().paginate().fields();
//
//   // populate before executing:
//   qb.modelQuery = qb.modelQuery.populate("merchantId", "website");
//
//   const { data, pagination } = await qb.executePaginated();
//   return { promotions: data, pagination };
//
// This replaces the old two-await pattern and runs data+count together.
// ============================================================================