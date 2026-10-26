/** الواجهة العامة لوحدة ما بعد البيع — النزاعات والمراجعات الموثّقة (ADR-002) */
export { AftersalesModule } from '../aftersales.module';
export { DisputesService, type Party } from '../application/disputes.service';
export { ReviewsService } from '../application/reviews.service';
export { refreshRatings } from '../application/ratings';
