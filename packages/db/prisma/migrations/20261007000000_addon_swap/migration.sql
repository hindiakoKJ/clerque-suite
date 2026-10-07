-- An add-on line can be part of a swap ("Oatmilk": take the drink's milk out,
-- pour oat milk instead, at the drink's own amount). Existing lines stay ADD,
-- which is exactly what they did before. Additive only: nothing is rewritten.

-- CreateEnum
CREATE TYPE "ModifierIngredientRole" AS ENUM ('ADD', 'SWAP_OUT', 'SWAP_IN');

-- AlterTable
ALTER TABLE "modifier_option_ingredients" ADD COLUMN     "role" "ModifierIngredientRole" NOT NULL DEFAULT 'ADD';
