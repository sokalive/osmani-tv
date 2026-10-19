#!/usr/bin/env node
'use strict';

/**
 * Category views: Sports and Tamthilia lists, no Home banner.
 * Run: node scripts/verify-category-channel-views.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function loadVisibility() {
  const src = read('lib/channelTabVisibility.js').replace(
    /export\s*\{[^}]+\}\s*from\s*['"]\.\/channelOrder['"];?/,
    '',
  );
  const body = src.replace(/\bexport\s+/g, '');
  return new Function(
    `${body}
    return {
      catalogShowsHomeBanner,
      isCategorySpecificCatalog,
      activeCategoryPill,
      filterCatalogChannels,
      channelAppearsOnNavigatorTab,
    };`,
  )();
}

const {
  catalogShowsHomeBanner,
  isCategorySpecificCatalog,
  activeCategoryPill,
  filterCatalogChannels,
} = loadVisibility();

const sports = { id: 's1', name: 'Sports 1', category: 'Sports', isLive: true, access: 'premium' };
const tamthilia = { id: 't1', name: 'Tamthilia 1', category: 'Tamthilia', isLive: false, access: 'free' };
const homeOnly = { id: 'h1', name: 'Home 1', category: 'Home', isLive: true, access: 'premium' };
const catalog = [sports, tamthilia, homeOnly];

const sportsRows = filterCatalogChannels(catalog, 'sports', 'Zote').map((row) => row.id);
if (sportsRows.length === 1 && sportsRows[0] === 's1') pass('Sports view lists only Sports');
else fail(`Sports view rows: ${sportsRows.join(',')}`);

const tamthiliaRows = filterCatalogChannels(catalog, 'tamthilia', 'Zote').map((row) => row.id);
if (tamthiliaRows.length === 1 && tamthiliaRows[0] === 't1') pass('Tamthilia view lists only Tamthilia');
else fail(`Tamthilia view rows: ${tamthiliaRows.join(',')}`);

const homeRows = filterCatalogChannels(catalog, 'home', 'Zote').map((row) => row.id);
if (homeRows.length === 1 && homeRows[0] === 'h1') pass('Zote on Home keeps the eligible Home list');
else fail(`Home Zote rows: ${homeRows.join(',')}`);

if (!catalogShowsHomeBanner('sports', 'Zote') && !catalogShowsHomeBanner('tamthilia', 'Zote')) {
  pass('Sports and Tamthilia views hide the Home banner');
} else fail('category views must hide the Home banner');

if (catalogShowsHomeBanner('home', 'Zote') && catalogShowsHomeBanner('home', 'Trending')) {
  pass('returning Home restores the banner');
} else fail('Home Zote and Trending must show the banner');

if (isCategorySpecificCatalog('sports', 'Zote') && !isCategorySpecificCatalog('home', 'Zote')) {
  pass('category view flag follows the open tab');
} else fail('category view flag mismatch');

if (activeCategoryPill('sports', 'Zote') === 'Sports' && activeCategoryPill('home', 'Zote') === 'Zote') {
  pass('Sports tab selects the Sports category button');
} else fail('active category pill mismatch');

const emptySports = filterCatalogChannels([homeOnly, tamthilia], 'sports', 'Zote');
if (emptySports.length === 0) pass('empty Sports category does not show unrelated channels');
else fail('empty Sports category leaked channels');

const app = read('App.js');
if (
  app.includes('showHomeBanner && bannerSlides.length > 0') &&
  app.includes('<BannerCarousel') &&
  app.includes('catalogShowsHomeBanner')
) {
  pass('Home banner render is gated by the category view');
} else fail('App.js must gate BannerCarousel with catalogShowsHomeBanner');

if (app.includes("navigation.navigate('Sports')") && app.includes("navigation.navigate('Tamthilia')")) {
  pass('category buttons open the existing Sports and Tamthilia views');
} else fail('category buttons must open the existing tab views');

if (app.includes("navigation.navigate('Home')") && app.includes("filter === 'Zote'")) {
  pass('Zote from a category view returns Home');
} else fail('Zote must return to Home');

if (app.includes('Hakuna chaneli katika kundi hili.')) {
  pass('empty category has its own empty state');
} else fail('empty category copy missing');

if (app.includes("navigation.navigate('ChannelPlayer'")) {
  pass('category selection still opens the existing player route');
} else fail('channel playback navigation changed');

if (app.includes('>KULIPIA<') && app.includes("liveLabel: isLive ? 'LIVE' : 'OFFLINE'")) {
  pass('LIVE and KULIPIA labels remain on channel cards');
} else fail('LIVE or KULIPIA card labels missing');

const shared = { id: 'b1', name: 'Shared', visibleTabs: ['home', 'sports'], isLive: true };
const pillSports = filterCatalogChannels([...catalog, shared], 'home', 'Sports').map((row) => row.id);
if (pillSports.length === 1 && pillSports[0] === 'b1') {
  pass('Home Sports filter keeps only channels classified as Sports');
} else fail(`Home Sports filter rows: ${pillSports.join(',')}`);
