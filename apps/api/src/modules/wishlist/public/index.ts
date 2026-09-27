/** الواجهة العامة لوحدة المفضّلة — ADR-002 */
export { WishlistModule } from '../wishlist.module';
export {
  WishlistService,
  MAX_WISHLIST,
  WISHLIST_LOW_STOCK,
  type WishlistItemView,
  type WishlistMoney,
  type WishlistState,
  type WishlistView,
} from '../application/wishlist.service';
