import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';

@Controller()
export class DashboardController {
  @Get()
  getDashboard(@Res() res: Response): void {
    res.sendFile(join(process.cwd(), 'public', 'index.html'));
  }
}
