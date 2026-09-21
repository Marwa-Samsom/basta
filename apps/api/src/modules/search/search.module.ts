import { Module } from '@nestjs/common';
import { SearchService } from './application/search.service';
import { MeiliClient } from './infrastructure/meili.client';

@Module({
  providers: [MeiliClient, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
