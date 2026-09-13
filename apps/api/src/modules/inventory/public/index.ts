/**
 * الواجهة العامة لوحدة المخزون — ADR-002.
 *
 * الوحدة لا تعتمد على الكتالوج: هي الطبقة الأدنى. الكتالوج يتحقق من ملكية
 * المتغيّر ثم يستدعيها، والمنسّق (المرحلة 08) يحجز ويثبّت عبرها.
 */
export { InventoryModule } from '../inventory.module';
export {
  InventoryService,
  DEFAULT_LOW_STOCK_THRESHOLD,
  type MovementContext,
  type ReservationResult,
  type StockView,
  type Tx,
} from '../application/inventory.service';
export { ReservationSweeper } from '../application/reservation-sweeper';
export {
  MOVEMENT_REASONS,
  StockBelowReservedError,
  availableOf,
  type MovementReason,
  type ReservationLineInput,
  type StockChange,
} from '../domain/stock';
