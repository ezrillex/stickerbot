import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

function getTodayUtcString() {
  return new Date().toISOString().split('T')[0];
}

export class DailyLimiter {
  constructor({ limit = config.bot.dailyLimit, usageFile = USAGE_FILE, today = getTodayUtcString } = {}) {
    this.limit = limit;
    this.usageFile = usageFile;
    this.today = today;
    this.currentDate = this.today();
    this.count = 0;
    this.init();
  }

  init() {
    try {
      fs.mkdirSync(path.dirname(this.usageFile), { recursive: true });

      if (fs.existsSync(this.usageFile)) {
        const raw = fs.readFileSync(this.usageFile, 'utf-8');
        const data = JSON.parse(raw);
        const today = this.today();

        if (data.date === today) {
          this.currentDate = data.date;
          if (!Number.isSafeInteger(data.count) || data.count < 0) {
            throw new Error('Invalid usage count');
          }
          this.count = data.count;
        } else {
          // New UTC day: reset
          this.currentDate = today;
          this.count = 0;
          this.save();
        }
      } else {
        this.save();
      }
    } catch (err) {
      console.warn('[Limiter] Error initializing usage file, using in-memory tracker:', err.message);
    }
  }

  save() {
    try {
      const data = {
        date: this.currentDate,
        count: this.count,
        limit: this.limit,
        lastUpdated: new Date().toISOString()
      };
      const tempFile = `${this.usageFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempFile, this.usageFile);
    } catch (err) {
      console.error('[Limiter] Error saving usage data:', err.message);
    }
  }

  checkReset() {
    const today = this.today();
    if (this.currentDate !== today) {
      console.log(`[Limiter] New UTC day detected (${today}). Resetting daily limit counter.`);
      this.currentDate = today;
      this.count = 0;
      this.save();
    }
  }

  tryAcquire() {
    this.checkReset();
    if (this.count < this.limit) {
      this.count++;
      this.save();
      return true;
    }
    return false;
  }

  refund(acquiredDate = this.currentDate) {
    this.checkReset();
    if (acquiredDate !== this.currentDate) return;
    if (this.count > 0) {
      this.count--;
      this.save();
    }
  }

  getRemaining() {
    this.checkReset();
    return Math.max(0, this.limit - this.count);
  }

  getStatus() {
    this.checkReset();
    return {
      date: this.currentDate,
      used: this.count,
      limit: this.limit,
      remaining: this.getRemaining()
    };
  }
}

export const limiter = new DailyLimiter();
