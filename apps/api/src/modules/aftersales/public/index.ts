/** الواجهة العامة لوحدة ما بعد البيع — النزاعات والمراجعات الموثّقة (ADR-002) */
export { AftersalesModule } from '../aftersales.module';
export { DisputesService, OUTCOME_AR, OUTCOME_CUSTOMER_TRANSFER_AR, REASON_AR, type Party } from '../application/disputes.service';
export { ReviewsService } from '../application/reviews.service';
export { refreshRatings } from '../application/ratings';
