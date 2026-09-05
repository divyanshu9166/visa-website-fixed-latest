// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { EnumChangefreq } from 'sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://easyvisacheck.com',
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: true,
    },
  },

  integrations: [
    sitemap({
      // Exclude utility, account, and error pages from sitemap
      filter(page) {
        const excludedPaths = [
          '/login',
          '/register',
          '/dashboard',
          '/404',
          '/500',
          '/confirm', // email confirmation page
        ];
        const pathname = new URL(page).pathname.replace(/\/$/, '') || '/';
        return !excludedPaths.includes(pathname);
      },
      // Higher-value pages get a higher priority hint for crawlers.
      customPages: undefined,
      serialize(item) {
        const url = item.url;
        const pathname = new URL(url).pathname;
        if (pathname === '/' || pathname === '') {
          item.priority = 1.0;
        } else if (/\/uscis-processing-times\/(h1b-visa|i-140|i-485-eb|n-400)\/?$/.test(url) || url.endsWith('/uscis-processing-times/') || url.endsWith('/green-card/visa-bulletin/')) {
          item.priority = 0.9;
        } else if (url.includes('/uscis-processing-times/') || url.includes('/green-card/visa-bulletin/')) {
          item.priority = 0.8;
        } else if (url.includes('/us-visa-appointment-wait-times/')) {
          item.priority = 0.7;
        } else if (url.includes('/h1b/') || url.includes('/tools/') || url.includes('calculator') || url.includes('/blog/')) {
          item.priority = 0.8;
        } else if (url.includes('/uscis-trackers') || url.includes('/trackers/') || url.includes('/us-visa-trackers/')) {
          item.priority = 0.7;
        } else if (url.includes('/resources/') || url.includes('/green-card/') || url.includes('/visa-stats')) {
          item.priority = 0.7;
        } else {
          item.priority = 0.5;
        }
        item.changefreq = url.includes('processing-times') || url.includes('visa-bulletin') || url.includes('wait-times') || url.includes('/blog/') ? EnumChangefreq.DAILY : EnumChangefreq.MONTHLY;
        return item;
      },
    }),
  ],
});
