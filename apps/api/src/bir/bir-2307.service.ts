/**
 * Bir2307Service — dedicated wrapper around the BIR Form 2307 ("Certificate
 * of Creditable Tax Withheld at Source") generation flow.
 *
 * The heavy lifting (per-vendor aggregation of WHT bills grouped by ATC code,
 * payor/payee block resolution, period bounds) already lives in BirService.
 * This service exposes a cleaner Sprint-22-shaped API and a "list-all" helper
 * so the export module can render one workbook with one sheet per vendor.
 *
 * The returned shape is `Bir2307Data` — consumed by
 * ExportService.buildBir2307Workbook to render the BIR-layout XLSX.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BirService } from './bir.service';

export interface Bir2307Data {
  year:       number;
  quarter:    1 | 2 | 3 | 4 | null;
  periodFrom: string;
  periodTo:   string;
  payor: {
    registeredName: string;
    tin:            string;
    address:        string;
  };
  payee: {
    vendorId:       string;
    registeredName: string;
    tin:            string;
    address:        string;
  };
  atcRows: {
    atcCode:        string;
    months:         { month: number; taxBase: number; taxWithheld: number }[];
    totalTaxBase:   number;
    totalWithheld:  number;
  }[];
  grandTotalTaxBase:  number;
  grandTotalWithheld: number;
  billCount:          number;
  generatedAt:        string;
}

@Injectable()
export class Bir2307Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bir:    BirService,
  ) {}

  /**
   * Build a single 2307 dataset for one vendor + quarter (or full year if
   * quarter is null). Delegates aggregation to BirService.get2307Data so
   * the existing 379-test baseline stays green.
   */
  async generateForVendor(
    tenantId: string,
    vendorId: string,
    year:     number,
    quarter:  1 | 2 | 3 | 4 | null,
  ): Promise<Bir2307Data> {
    const raw = await this.bir.get2307Data(tenantId, vendorId, year, quarter);
    return {
      year:       raw.year,
      quarter:    raw.quarter,
      periodFrom: raw.periodFrom,
      periodTo:   raw.periodTo,
      payor:      raw.payor,
      payee:      { ...raw.payee, vendorId },
      atcRows:    raw.atcRows,
      grandTotalTaxBase:  raw.grandTotalTaxBase,
      grandTotalWithheld: raw.grandTotalWithheld,
      billCount:          raw.billCount,
      generatedAt:        raw.generatedAt,
    };
  }

  /**
   * Build 2307 datasets for every vendor that had WHT in the period.
   * Returns an empty array if none — the controller can 404 if it wants.
   */
  async generateForAllVendors(
    tenantId: string,
    year:     number,
    quarter:  1 | 2 | 3 | 4 | null,
  ): Promise<Bir2307Data[]> {
    const vendors = await this.bir.list2307VendorsForPeriod(tenantId, year, quarter);
    const out: Bir2307Data[] = [];
    for (const v of vendors) {
      out.push(await this.generateForVendor(tenantId, v.vendorId, year, quarter));
    }
    return out;
  }
}
