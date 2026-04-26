/**
 * Bootstrap seed — creates one Tenant, one Branch, and one BUSINESS_OWNER user.
 *
 * Run from the repo root:
 *   cd packages/db && npm run seed
 *
 * Or set the env vars and run directly:
 *   DATABASE_URL="..." npx ts-node --project tsconfig.json prisma/seed.ts
 *
 * Credentials printed at the end — change the password after first login.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Customise these before seeding ──────────────────────────────────────────
const TENANT_NAME     = 'Demo Business';
const TENANT_SLUG     = 'demo';            // used as "Company Code" on login
const BRANCH_NAME     = 'Main Branch';
const OWNER_NAME      = 'Admin';
const OWNER_EMAIL     = 'admin@demo.com';
const OWNER_PASSWORD  = 'Admin1234!';      // change after first login
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…');

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      businessType: 'RETAIL',
      status: 'ACTIVE',
      tier: 'TIER_1',
      branchQuota: 3,
      cashierSeatQuota: 5,
    },
  });
  console.log(`  Tenant: ${tenant.name} (slug: ${tenant.slug})`);

  // ── Branch ────────────────────────────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { id: `seed-branch-${tenant.id}` },
    update: {},
    create: {
      id: `seed-branch-${tenant.id}`,
      tenantId: tenant.id,
      name: BRANCH_NAME,
      isActive: true,
    },
  });
  console.log(`  Branch: ${branch.name}`);

  // ── Business Owner ────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 12);

  const owner = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: OWNER_EMAIL } },
    update: {},
    create: {
      tenantId: tenant.id,
      branchId: branch.id,
      email: OWNER_EMAIL,
      passwordHash,
      name: OWNER_NAME,
      role: 'BUSINESS_OWNER',
      isActive: true,
      appAccess: {
        create: [
          { appCode: 'POS',     level: 'FULL' },
          { appCode: 'LEDGER',  level: 'FULL' },
          { appCode: 'PAYROLL', level: 'FULL' },
        ],
      },
    },
    include: { appAccess: true },
  });
  console.log(`  User: ${owner.name} <${owner.email}> (role: ${owner.role})`);

  // ── Demo Cashier ──────────────────────────────────────────────────────────
  const cashierHash = await bcrypt.hash('Cashier1234!', 12);

  const cashier = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'cashier@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      branchId: branch.id,
      email: 'cashier@demo.com',
      passwordHash: cashierHash,
      name: 'Demo Cashier',
      role: 'CASHIER',
      isActive: true,
      appAccess: {
        create: [
          { appCode: 'POS',     level: 'OPERATOR' },
          { appCode: 'LEDGER',  level: 'NONE' },
          { appCode: 'PAYROLL', level: 'CLOCK_ONLY' },
        ],
      },
    },
  });
  console.log(`  User: ${cashier.name} <${cashier.email}> (role: ${cashier.role})`);

  // ── Categories ────────────────────────────────────────────────────────────
  const categoryData = [
    { name: 'Food',      sortOrder: 0 },
    { name: 'Drinks',    sortOrder: 1 },
    { name: 'Snacks',    sortOrder: 2 },
    { name: 'Add-ons',   sortOrder: 3 },
  ];

  const categories: Record<string, string> = {};
  for (const cat of categoryData) {
    const existing = await prisma.category.findFirst({
      where: { tenantId: tenant.id, name: cat.name },
    });
    const record = existing ?? await prisma.category.create({
      data: { tenantId: tenant.id, ...cat },
    });
    categories[cat.name] = record.id;
    console.log(`  Category: ${record.name}`);
  }

  // ── Products + Inventory ──────────────────────────────────────────────────
  const productData = [
    // Food
    { name: 'Garlic Rice',       price: 35,  cost: 12, category: 'Food',   stock: 100, vat: true  },
    { name: 'Sinangag',          price: 40,  cost: 14, category: 'Food',   stock: 80,  vat: true  },
    { name: 'Tapsilog',          price: 120, cost: 55, category: 'Food',   stock: 50,  vat: true  },
    { name: 'Tosilog',           price: 110, cost: 50, category: 'Food',   stock: 50,  vat: true  },
    { name: 'Longsilog',         price: 115, cost: 52, category: 'Food',   stock: 50,  vat: true  },
    { name: 'Adobo Rice Bowl',   price: 95,  cost: 40, category: 'Food',   stock: 60,  vat: true  },
    // Drinks
    { name: 'Bottled Water',     price: 20,  cost: 8,  category: 'Drinks', stock: 200, vat: false },
    { name: 'Softdrink (Regular)',price: 35, cost: 12, category: 'Drinks', stock: 120, vat: false },
    { name: 'Softdrink (Large)', price: 50,  cost: 18, category: 'Drinks', stock: 80,  vat: false },
    { name: 'Iced Coffee',       price: 75,  cost: 25, category: 'Drinks', stock: 60,  vat: true  },
    { name: 'Fresh Buko Juice',  price: 60,  cost: 20, category: 'Drinks', stock: 40,  vat: false },
    // Snacks
    { name: 'Banana Cue',        price: 25,  cost: 10, category: 'Snacks', stock: 100, vat: false },
    { name: 'Turon (2 pcs)',     price: 30,  cost: 12, category: 'Snacks', stock: 80,  vat: false },
    { name: 'Puto',              price: 15,  cost: 5,  category: 'Snacks', stock: 150, vat: false },
    { name: 'Mamon',             price: 20,  cost: 7,  category: 'Snacks', stock: 100, vat: false },
    // Add-ons
    { name: 'Extra Rice',        price: 20,  cost: 5,  category: 'Add-ons', stock: 999, vat: true },
    { name: 'Extra Egg',         price: 15,  cost: 4,  category: 'Add-ons', stock: 200, vat: true },
    { name: 'Sawsawan Set',      price: 10,  cost: 2,  category: 'Add-ons', stock: 500, vat: false },
  ];

  for (const p of productData) {
    const existing = await prisma.product.findFirst({
      where: { tenantId: tenant.id, name: p.name },
    });

    const product = existing ?? await prisma.product.create({
      data: {
        tenantId:      tenant.id,
        categoryId:    categories[p.category],
        name:          p.name,
        price:         p.price,
        costPrice:     p.cost,
        isVatable:     p.vat,
        inventoryMode: 'UNIT_BASED',
        isActive:      true,
      },
    });

    // Inventory per branch
    await prisma.inventoryItem.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: product.id } },
      update: {},
      create: {
        tenantId:  tenant.id,
        branchId:  branch.id,
        productId: product.id,
        quantity:  p.stock,
        lowStockAlert: Math.floor(p.stock * 0.1),
      },
    });

    console.log(`  Product: ${p.name}  ₱${p.price}`);
  }

  console.log('\nSeed complete.');
  console.log('─────────────────────────────────────────');
  console.log(`  Company Code : ${TENANT_SLUG}`);
  console.log(`  Owner email  : ${OWNER_EMAIL}`);
  console.log(`  Owner pw     : ${OWNER_PASSWORD}  ← change this`);
  console.log(`  Cashier email: cashier@demo.com`);
  console.log(`  Cashier pw   : Cashier1234!       ← change this`);
  console.log('─────────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
