import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

function getTodayUtcString() {
  return new Date().toISOString().split('T')[0];
}

class DailyLimiter {
  constructor() {
    this.limit = config.bot.dailyLimit;
    this.currentDate = getTodayUtcString();
    this.count = 0;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(USAGE_FILE)) {
        const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        const today = getTodayUtcString();

        if (data.date === today) {
          this.currentDate = data.date;
          this.count = data.count || 0;
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
      fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Limiter] Error saving usage data:', err.message);
    }
  }

  checkReset() {
    const today = getTodayUtcString();
    if (this.currentDate !== today) {
      console.log(`[Limiter] New UTC day detected (${today}). Resetting daily limit counter.`);
      this.currentDate = today;
      this.count = 0;
      this.save();
    }
  }

  canGenerate() {
    this.checkReset();
    return this.count < this.limit;
  }

  increment() {
    this.checkReset();
    this.count++;
    this.save();
    return this.count;
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
