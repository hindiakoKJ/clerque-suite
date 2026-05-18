import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController, ProductPhotosController } from './products.controller';

@Module({
  providers: [ProductsService],
  // Order matters: ProductPhotosController has the more-specific route
  // `products/photos/:id` and must register before `products/:id` on
  // ProductsController to win the Express first-match check.
  controllers: [ProductPhotosController, ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
