'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Droplets,
  CloudSun,
  CloudRain,
  Cloud,
  Sun,
  CloudLightning,
  CloudFog,
  Snowflake,
  Stethoscope,
  TrendingUp,
  TrendingDown,
  Minus,
  Sprout,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Volume2,
  Square,
  Users,
  MapPin,
  Bell,
  Sparkles,
  Layers,
  CalendarDays,
  AlertTriangle,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { READ_ALOUD_EVENT } from '@/components/voice-assistant';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { readCache, writeCache, describeAge } from '@/lib/offline';
import { useVoice, buildSpokenBriefing } from '@/lib/voice';
import { useTranslation } from '@/lib/language-context';
import { LANGUAGES } from '@/lib/translations';
import type { NearbyOutbreaks } from '@/lib/types';
import type { Dashboard, ActionItem } from '@/lib/types';
import {
  Card,
  SectionHeading,
  Badge,
  ErrorState,
  Notice,
  SkeletonCard,
  severityStyles,
} from '@/components/ui';
import {
  cn,
  formatDay,
  cropLabel,
  humanise,
  weatherIcon,
  timeAgo,
  formatRupees,
} from '@/lib/utils';

// ── Multi-Language Translation Dictionaries for mockup text ──
const DASHBOARD_LOCALES: Record<string, Record<string, string>> = {
  en: {
    soilMoisture: 'Soil Moisture',
    irrigationStatus: 'Irrigation Status',
    sevenDayRainfall: '7-Day Rainfall',
    cropHealthScore: 'Crop Health Score',
    noIrrigation: 'No irrigation',
    irrigationDue: 'Irrigation Due',
    notNeeded: 'Not needed',
    urgent: 'Urgent',
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    excellent: 'Excellent',
    good: 'Good',
    warning: 'Warning',
    waterIrrigation: 'Water & Irrigation',
    soilWaterUsed: 'Soil Water Used',
    weatherForecast: 'Weather Forecast',
    humidity: 'Humidity',
    wind: 'Wind',
    updated: 'Updated',
    priorityAlerts: 'Priority Alerts',
    viewAll: 'View all',
    overallCropHealth: 'Overall Crop Health',
    quickActions: 'Quick Actions',
    irrigateNow: 'Irrigate Now',
    startIrrigation: 'Start irrigation',
    checkCrop: 'Check Crop',
    scanDiagnose: 'Scan & diagnose',
    marketPrices: 'Market Prices',
    checkLatestPrices: 'Check latest prices',
    askAi: 'Ask AI',
    getFarmingAdvice: 'Get farming advice',
    planAhead: 'Plan ahead',
    whatToPlant: 'What to plant',
    cropsSuited: 'Crops ranked for your soil, season and local climate.',
    planPredict: 'Plan & predict',
    fertiliserToBuy: 'Fertiliser to buy, when to apply it, and expected yield.',
    manage: 'Manage',
    seeTrends: 'See trends',
    logIssue: 'Log an issue',
    allCropsHealthy: 'All crops healthy & secure',
    noActionsRequired: 'No immediate actions required',
    greetingMorning: 'Good morning, {name}! 🍃',
    greetingAfternoon: 'Good afternoon, {name}! 🍃',
    greetingEvening: 'Good evening, {name}! 🍃',
    happeningToday: "Here's what's happening on your farm today.",
    moistureTipGood: 'Great! Your field has enough moisture. Keep monitoring regularly.',
    moistureTipUrgent: 'Critical: Crop needs about {amount} mm of water.',
    healthGood: 'No major issues found. Your crops are healthy and growing well.',
    healthIssueSingle: '1 active issue reported. Check health log for recommendations.',
    healthIssuePlural: '{count} active issues reported. Check health log for recommendations.',
    limitedData: 'Limited',
    daysLeft: 'days left',
    reportedNearYou: 'Reported near you',
    farmersWithin:
      'Farmers within {radius} km have reported these in the last 14 days. Worth checking your own crop.',
    checkMyCrop: 'Check my crop',
    weatherStale: 'Live weather is unavailable. Showing saved data.',
    irrigationNoData: 'Irrigation guidance is unavailable right now.',
    soilType: 'Soil',
    season: 'Season',
    areaHa: '{area} ha',
    rising: 'Rising',
    falling: 'Falling',
    stable: 'Stable',
    sell: 'Sell',
    hold: 'Hold',
    watch: 'Watch',
    noPriceData: 'No price data for your crops yet.',
    recentAlerts: 'Recent Alerts',
    noAlerts: 'No alerts for your farm.',
    markAllRead: 'Mark all read',
    showLess: 'Show less',
    recentIssues: 'Recent issues',
    noIssues: 'No open issues',
    notNeededToday: 'Not needed today',
    applyMm: 'Apply {amount} mm',
    rainChance: '{percent}% chance of rain',
    activeIssuesCount: '{count} open',
    live: 'Live',
  },
  hi: {
    soilMoisture: 'मिट्टी की नमी',
    irrigationStatus: 'सिंचाई की स्थिति',
    sevenDayRainfall: '7-दिवसीय वर्षा',
    cropHealthScore: 'फसल स्वास्थ्य स्कोर',
    noIrrigation: 'सिंचाई की ज़रूरत नहीं',
    irrigationDue: 'सिंचाई आवश्यक',
    notNeeded: 'ज़रूरत नहीं',
    urgent: 'ज़रूरी',
    low: 'कम',
    moderate: 'मध्यम',
    high: 'अधिक',
    excellent: 'उत्कृष्ट',
    good: 'अच्छा',
    warning: 'चेतावनी',
    waterIrrigation: 'जल और सिंचाई',
    soilWaterUsed: 'उपयोग किया गया पानी',
    weatherForecast: 'मौसम का पूर्वानुमान',
    humidity: 'आर्द्रता',
    wind: 'हवा',
    updated: 'अपडेट',
    priorityAlerts: 'प्राथमिकता अलर्ट',
    viewAll: 'सभी देखें',
    overallCropHealth: 'फसल का कुल स्वास्थ्य',
    quickActions: 'त्वरित कार्य',
    irrigateNow: 'अभी सिंचाई करें',
    startIrrigation: 'सिंचाई शुरू करें',
    checkCrop: 'फसल जांचें',
    scanDiagnose: 'जांचें और निदान करें',
    marketPrices: 'बाजार भाव',
    checkLatestPrices: 'ताजा भाव देखें',
    askAi: 'AI से पूछें',
    getFarmingAdvice: 'खेती की सलाह लें',
    planAhead: 'आगे की योजना',
    whatToPlant: 'क्या बोएँ',
    cropsSuited: 'आपकी मिट्टी, मौसम और स्थानीय जलवायु के अनुकूल फसलें।',
    planPredict: 'योजना और अनुमान',
    fertiliserToBuy: 'खाद कब और कितनी डालें, साथ ही अनुमानित पैदावार।',
    manage: 'प्रबंधन',
    seeTrends: 'रुझान देखें',
    logIssue: 'समस्या दर्ज करें',
    allCropsHealthy: 'सभी फसलें स्वस्थ और सुरक्षित हैं',
    noActionsRequired: 'कोई तत्काल कार्य आवश्यक नहीं है',
    greetingMorning: 'शुभ प्रभात, {name}! 🍃',
    greetingAfternoon: 'नमस्कार, {name}! 🍃',
    greetingEvening: 'शुभ संध्या, {name}! 🍃',
    happeningToday: 'आज आपके खेत में क्या हो रहा है, यहाँ देखें।',
    moistureTipGood: 'बहुत बढ़िया! आपके खेत में पर्याप्त नमी है। नियमित निगरानी रखें।',
    moistureTipUrgent: 'महत्वपूर्ण: फसल को लगभग {amount} मिमी पानी की आवश्यकता है।',
    healthGood: 'कोई बड़ी समस्या नहीं मिली। आपकी फसलें स्वस्थ हैं और अच्छी बढ़ रही हैं।',
    healthIssueSingle: '1 सक्रिय समस्या दर्ज की गई है। स्वास्थ्य लॉग देखें।',
    healthIssuePlural: '{count} सक्रिय समस्याएं दर्ज हैं। स्वास्थ्य लॉग देखें।',
    limitedData: 'सीमित',
    daysLeft: 'दिन शेष',
    reportedNearYou: 'आपके आस-पास रिपोर्ट की गई समस्याएं',
    farmersWithin:
      '{radius} किमी के दायरे में किसानों ने पिछले 14 दिनों में ये समस्याएं रिपोर्ट की हैं।',
    checkMyCrop: 'अपनी फसल जांचें',
    weatherStale: 'लाइव मौसम उपलब्ध नहीं है। सहेजा गया डेटा दिखाया जा रहा है।',
    irrigationNoData: 'सिंचाई की सलाह अभी उपलब्ध नहीं है।',
    soilType: 'मिट्टी',
    season: 'मौसम',
    areaHa: '{area} हेक्टेयर',
    rising: 'बढ़ रहा',
    falling: 'घट रहा',
    stable: 'स्थिर',
    sell: 'बेचें',
    hold: 'रोकें',
    watch: 'नज़र रखें',
    noPriceData: 'आपकी फसलों के भाव अभी उपलब्ध नहीं हैं।',
    recentAlerts: 'हालिया अलर्ट',
    noAlerts: 'आपके खेत के लिए कोई अलर्ट नहीं।',
    markAllRead: 'सभी पढ़े हुए चिह्नित करें',
    showLess: 'कम दिखाएँ',
    recentIssues: 'हालिया समस्याएं',
    noIssues: 'कोई खुली समस्या नहीं',
    notNeededToday: 'आज ज़रूरत नहीं',
    applyMm: '{amount} मिमी पानी दें',
    rainChance: 'बारिश की {percent}% संभावना',
    activeIssuesCount: '{count} खुली',
    live: 'लाइव',
  },
  pa: {
    soilMoisture: 'ਮਿੱਟੀ ਦੀ ਨਮੀ',
    irrigationStatus: 'ਸਿੰਚਾਈ ਦੀ ਸਥਿਤੀ',
    sevenDayRainfall: '7-ਦਿਨ ਦੀ ਬਾਰਸ਼',
    cropHealthScore: 'ਫਸਲ ਸਿਹਤ ਸਕੋਰ',
    noIrrigation: 'ਸਿੰਚਾਈ ਦੀ ਲੋੜ ਨਹੀਂ',
    irrigationDue: 'ਸਿੰਚਾਈ ਦੀ ਲੋੜ ਹੈ',
    notNeeded: 'ਲੋੜ ਨਹੀਂ',
    urgent: 'ਜ਼ਰੂਰੀ',
    low: 'ਘੱਟ',
    moderate: 'ਦਰਮਿਆਨਾ',
    high: 'ਬਹੁਤ',
    excellent: 'ਬਹੁਤ ਵਧੀਆ',
    good: 'ਚੰਗਾ',
    warning: 'ਚੇਤਾਵਨੀ',
    waterIrrigation: 'ਪਾਣੀ ਅਤੇ ਸਿੰਚਾਈ',
    soilWaterUsed: 'ਵਰਤਿਆ ਗਿਆ ਪਾਣੀ',
    weatherForecast: 'ਮੌਸਮ ਦਾ ਅਨੁਮਾਨ',
    humidity: 'ਨਮੀ',
    wind: 'ਹਵਾ',
    updated: 'ਅੱਪਡੇਟ',
    priorityAlerts: 'ਤਰਜੀਹੀ ਚੇਤਾਵਨੀਆਂ',
    viewAll: 'ਸਭ ਦੇਖੋ',
    overallCropHealth: 'ਫਸਲ ਦੀ ਕੁੱਲ ਸਿਹਤ',
    quickActions: 'ਤੁਰੰਤ ਕਾਰਵਾਈਆਂ',
    irrigateNow: 'ਹੁਣੇ ਸਿੰਚਾਈ ਕਰੋ',
    startIrrigation: 'ਸਿੰਚਾਈ ਸ਼ੁਰੂ ਕਰੋ',
    checkCrop: 'ਫਸਲ ਚੈੱਕ ਕਰੋ',
    scanDiagnose: 'ਜਾਂਚ ਅਤੇ ਇਲਾਜ',
    marketPrices: 'ਮੰਡੀ ਦੇ ਭਾਅ',
    checkLatestPrices: 'ਤਾਜ਼ਾ ਭਾਅ ਦੇਖੋ',
    askAi: 'AI ਤੋਂ ਪੁੱਛੋ',
    getFarmingAdvice: 'ਖੇਤੀਬਾੜੀ ਸਲਾਹ ਲਓ',
    planAhead: 'ਅਗਲੀ ਯੋਜਨਾ',
    whatToPlant: 'ਕੀ ਬੀਜੀਏ',
    cropsSuited: 'ਤੁਹਾਡੀ ਮਿੱਟੀ, ਮੌਸਮ ਅਤੇ ਸਥਾਨਕ ਜਲਵਾਯੂ ਲਈ ਅਨੁਕੂਲ ਫਸਲਾਂ।',
    planPredict: 'ਯੋਜਨਾ ਅਤੇ ਅਨੁਮਾਨ',
    fertiliserToBuy: 'ਖਾਦ ਕਦੋਂ ਅਤੇ ਕਿੰਨੀ ਪਾਉਣੀ ਹੈ, ਅਤੇ ਅਨੁਮਾਨਿਤ ਝਾੜ।',
    manage: 'ਪ੍ਰਬੰਧ ਕਰੋ',
    seeTrends: 'ਰੁਝਾਨ ਦੇਖੋ',
    logIssue: 'ਸਮੱਸਿਆ ਦਰਜ ਕਰੋ',
    allCropsHealthy: 'ਸਾਰੀਆਂ ਫਸਲਾਂ ਤੰਦਰੁਸਤ ਅਤੇ ਸੁਰੱਖਿਅਤ ਹਨ',
    noActionsRequired: 'ਕਿਸੇ ਤੁਰੰਤ ਕੰਮ ਦੀ ਲੋੜ ਨਹੀਂ ਹੈ',
    greetingMorning: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ, {name}! 🍃',
    greetingAfternoon: 'ਨਮਸਕਾਰ, {name}! 🍃',
    greetingEvening: 'ਸ਼ੁਭ ਸ਼ਾਮ, {name}! 🍃',
    happeningToday: 'ਅੱਜ ਤੁਹਾਡੇ ਖੇਤ ਵਿੱਚ ਕੀ ਹੋ ਰਿਹਾ ਹੈ, ਇੱਥੇ ਦੇਖੋ।',
    moistureTipGood: 'ਬਹੁਤ ਵਧੀਆ! ਤੁਹਾਡੇ ਖੇਤ ਵਿੱਚ ਕਾਫ਼ੀ ਨਮੀ ਹੈ। ਨਿਯਮਤ ਨਿਗਰਾਨੀ ਰੱਖੋ।',
    moistureTipUrgent: 'ਜ਼ਰੂਰੀ: ਫਸਲ ਨੂੰ ਲਗਭਗ {amount} ਮਿਲੀਮੀਟਰ ਪਾਣੀ ਦੀ ਲੋੜ ਹੈ।',
    healthGood: 'ਕੋਈ ਵੱਡੀ ਸਮੱਸਿਆ ਨਹੀਂ ਮਿਲੀ। ਤੁਹਾਡੀਆਂ ਫਸਲਾਂ ਤੰਦਰੁਸਤ ਹਨ ਅਤੇ ਚੰਗੀ ਤਰ੍ਹਾਂ ਵਧ ਰਹੀਆਂ ਹਨ।',
    healthIssueSingle: '1 ਸਮੱਸਿਆ ਦਰਜ ਕੀਤੀ ਗਈ ਹੈ। ਸਿਹਤ ਰਿਕਾਰਡ ਦੇਖੋ।',
    healthIssuePlural: '{count} ਸਮੱਸਿਆਵਾਂ ਦਰਜ ਹਨ। ਸਿਹਤ ਰਿਕਾਰਡ ਦੇਖੋ।',
    limitedData: 'ਸੀਮਤ',
    daysLeft: 'ਦਿਨ ਬਾਕੀ',
    reportedNearYou: 'ਤੁਹਾਡੇ ਨੇੜੇ ਰਿਪੋਰਟ ਕੀਤੀਆਂ ਸਮੱਸਿਆਵਾਂ',
    farmersWithin:
      '{radius} ਕਿਲੋਮੀਟਰ ਦੇ ਅੰਦਰ ਕਿਸਾਨਾਂ ਨੇ ਪਿਛਲੇ 14 ਦਿਨਾਂ ਵਿੱਚ ਇਹ ਸਮੱਸਿਆਵਾਂ ਰਿਪੋਰਟ ਕੀਤੀਆਂ ਹਨ।',
    checkMyCrop: 'ਆਪਣੀ ਫਸਲ ਚੈੱਕ ਕਰੋ',
    weatherStale: 'ਮੌਸਮ ਦੀ ਜਾਣਕਾਰੀ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਸੇਵ ਕੀਤਾ ਡਾਟਾ ਦਿਖਾਇਆ ਜਾ ਰਿਹਾ ਹੈ।',
    irrigationNoData: 'ਸਿੰਚਾਈ ਦੀ ਸਲਾਹ ਇਸ ਵੇਲੇ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।',
    soilType: 'ਮਿੱਟੀ',
    season: 'ਮੌਸਮ',
    areaHa: '{area} ਹੈਕਟੇਅਰ',
    rising: 'ਵਧ ਰਿਹਾ',
    falling: 'ਘਟ ਰਿਹਾ',
    stable: 'ਸਥਿਰ',
    sell: 'ਵੇਚੋ',
    hold: 'ਰੋਕੋ',
    watch: 'ਨਜ਼ਰ ਰੱਖੋ',
    noPriceData: 'ਤੁਹਾਡੀਆਂ ਫਸਲਾਂ ਦੇ ਭਾਅ ਹਾਲੇ ਉਪਲਬਧ ਨਹੀਂ ਹਨ।',
    recentAlerts: 'ਤਾਜ਼ਾ ਅਲਰਟ',
    noAlerts: 'ਤੁਹਾਡੇ ਖੇਤ ਲਈ ਕੋਈ ਅਲਰਟ ਨਹੀਂ।',
    markAllRead: 'ਸਭ ਪੜ੍ਹੇ ਹੋਏ ਨਿਸ਼ਾਨ ਲਗਾਓ',
    showLess: 'ਘੱਟ ਦਿਖਾਓ',
    recentIssues: 'ਤਾਜ਼ਾ ਸਮੱਸਿਆਵਾਂ',
    noIssues: 'ਕੋਈ ਖੁੱਲ੍ਹੀ ਸਮੱਸਿਆ ਨਹੀਂ',
    notNeededToday: 'ਅੱਜ ਲੋੜ ਨਹੀਂ',
    applyMm: '{amount} ਮਿਲੀਮੀਟਰ ਪਾਣੀ ਦਿਓ',
    rainChance: 'ਬਾਰਸ਼ ਦੀ {percent}% ਸੰਭਾਵਨਾ',
    activeIssuesCount: '{count} ਖੁੱਲ੍ਹੀਆਂ',
    live: 'ਲਾਈਵ',
  },
  te: {
    soilMoisture: 'నేల తేమ',
    irrigationStatus: 'నీటి పారుదల స్థితి',
    sevenDayRainfall: '7-రోజుల వర్షపాతం',
    cropHealthScore: 'పంట ఆరోగ్య స్కోరు',
    noIrrigation: 'నీటి అవసరం లేదు',
    irrigationDue: 'నీరు పెట్టాలి',
    notNeeded: 'అవసరం లేదు',
    urgent: 'అవసరం',
    low: 'తక్కువ',
    moderate: 'మధ్యస్థం',
    high: 'ఎక్కువ',
    excellent: 'అద్భుతం',
    good: 'బాగుంది',
    warning: 'హెచ్చరిక',
    waterIrrigation: 'నీరు & నీటి పారుదల',
    soilWaterUsed: 'ఉపయోగించిన నేల నీరు',
    weatherForecast: 'వాతావరణ సూచన',
    humidity: 'తేమ',
    wind: 'గాలి',
    updated: 'అప్డేట్ చేయబడింది',
    priorityAlerts: 'ముఖ్యమైన హెచ్చరికలు',
    viewAll: 'అన్నీ చూడండి',
    overallCropHealth: 'పంట మొత్తం ఆరోగ్యం',
    quickActions: 'త్వరిత పనులు',
    irrigateNow: 'ఇప్పుడే నీరు పెట్టండి',
    startIrrigation: 'నీరు పెట్టడం ప్రారంభించండి',
    checkCrop: 'పంటను తనిఖీ చేయండి',
    scanDiagnose: 'పరీక్షించి నివారణ పొందండి',
    marketPrices: 'మార్కెట్ ధరలు',
    checkLatestPrices: 'తాజా ధరలు చూడండి',
    askAi: 'AIని అడగండి',
    getFarmingAdvice: 'వ్యవసాయ సలహా పొందండి',
    planAhead: 'ముందుస్తు ప్రణాళిక',
    whatToPlant: 'ఏ పంట వేయాలి',
    cropsSuited: 'మీ నేల, కాలం మరియు వాతావరణానికి సరిపోయే పంటలు.',
    planPredict: 'ప్రణాళిక & అంచనా',
    fertiliserToBuy: 'ఎరువులు ఎప్పుడు, ఎంత వేయాలో మరియు ఆశించిన దిగుబడి.',
    manage: 'निర్వహణ',
    seeTrends: 'ధరలు చూడండి',
    logIssue: 'సమస్యను తెలపండి',
    allCropsHealthy: 'అన్ని పంటలు ఆరోగ్యంగా మరియు సురక్షితంగా ఉన్నాయి',
    noActionsRequired: 'ఎటువంటి తక్షణ పనులు లేవు',
    greetingMorning: 'శుభోదయం, {name}! 🍃',
    greetingAfternoon: 'నమస్కారం, {name}! 🍃',
    greetingEvening: 'శుభ సాయంత్రం, {name}! 🍃',
    happeningToday: 'ఈరోజు మీ పొలంలో ఏం జరుగుతుందో ఇక్కడ చూడండి.',
    moistureTipGood: 'చాలా బాగుంది! పొలంలో తగినంత తేమ ఉంది. క్రమం తప్పకుండా పర్యవేక్షించండి.',
    moistureTipUrgent: 'ముఖ్యం: పంటకు దాదాపు {amount} మి.మీ నీరు అవసరం.',
    healthGood: 'ఎటువంటి ప్రధాన సమస్యలు లేవు. పంటలు ఆరోగ్యంగా పెరుగుతున్నాయి.',
    healthIssueSingle: '1 సమస్య నమోదైంది. ఆరోగ్య రికార్డులు చూడండి.',
    healthIssuePlural: '{count} సమస్యలు నమోదయ్యాయి. ఆరోగ్య రికార్డులు చూడండి.',
    limitedData: 'పరిమితం',
    daysLeft: 'రోజులు ఉన్నాయి',
    reportedNearYou: 'మీ పరిసరాల్లో నమోదైన సమస్యలు',
    farmersWithin: '{radius} కి.మీ పరిధిలో రైతులు గత 14 రోజుల్లో ఈ సమస్యలను తెలిపారు.',
    checkMyCrop: 'నా పంటను తనిఖీ చేయండి',
    weatherStale: 'వాతావరణ వివరాలు అందుబాటులో లేవు. పాత వివరాలు చూపబడుతున్నాయి.',
    irrigationNoData: 'నీటి పారుదల సలహా ప్రస్తుతం అందుబాటులో లేదు.',
    soilType: 'నేల',
    season: 'కాలం',
    areaHa: '{area} హెక్టార్లు',
    rising: 'పెరుగుతోంది',
    falling: 'తగ్గుతోంది',
    stable: 'స్థిరం',
    sell: 'అమ్మండి',
    hold: 'ఆపండి',
    watch: 'గమనించండి',
    noPriceData: 'మీ పంటల ధరలు ఇంకా అందుబాటులో లేవు.',
    recentAlerts: 'ఇటీవలి హెచ్చరికలు',
    noAlerts: 'మీ పొలానికి హెచ్చరికలు లేవు.',
    markAllRead: 'అన్నీ చదివినట్లు గుర్తించండి',
    showLess: 'తక్కువ చూపించు',
    recentIssues: 'ఇటీవలి సమస్యలు',
    noIssues: 'తెరిచిన సమస్యలు లేవు',
    notNeededToday: 'ఈరోజు అవసరం లేదు',
    applyMm: '{amount} మి.మీ నీరు పెట్టండి',
    rainChance: 'వర్షం వచ్చే అవకాశం {percent}%',
    activeIssuesCount: '{count} పరిష్కారం కాలేదు',
    live: 'లైవ్',
  },
  mr: {
    soilMoisture: 'मातीची आर्द्रता',
    irrigationStatus: 'सिंचनाची स्थिती',
    sevenDayRainfall: '7-दिवसांचा पाऊस',
    cropHealthScore: 'पीक आरोग्य स्कोर',
    noIrrigation: 'सिंचनाची गरज नाही',
    irrigationDue: 'सिंचन आवश्यक',
    notNeeded: 'गरज नाही',
    urgent: 'तातडीचे',
    low: 'कमी',
    moderate: 'मध्यम',
    high: 'जास्त',
    excellent: 'उत्कृष्ट',
    good: 'चांगले',
    warning: 'धोका / चेतावणी',
    waterIrrigation: 'पाणी आणि सिंचन',
    soilWaterUsed: 'वापरलेले पाणी',
    weatherForecast: 'हवामान अंदाज',
    humidity: 'दमटपणा',
    wind: 'वारा',
    updated: 'अपडेट केले',
    priorityAlerts: 'महत्वाचे अलर्ट',
    viewAll: 'सर्व पहा',
    overallCropHealth: 'पिकाचे एकूण आरोग्य',
    quickActions: 'त्वरित कृती',
    irrigateNow: 'आत्ता पाणी द्या',
    startIrrigation: 'सिंचन सुरू करा',
    checkCrop: 'पीक तपासा',
    scanDiagnose: 'तपासा आणि उपाय मिळवा',
    marketPrices: 'बाजार भाव',
    checkLatestPrices: 'ताजे भाव पहा',
    askAi: 'AI ला विचारा',
    getFarmingAdvice: 'शेती सल्ला मिळवा',
    planAhead: 'पुढील नियोजन',
    whatToPlant: 'काय पेरावे',
    cropsSuited: 'तुमच्या शेतजमीन, हंगाम आणि स्थानिक हवामानास अनुकूल पिके.',
    planPredict: 'नियोजन आणि अंदाज',
    fertiliserToBuy: 'खते कधी आणि किती टाकावीत, आणि अपेक्षित उत्पादन.',
    manage: 'व्यवस्थापन',
    seeTrends: 'रुझान पहा',
    logIssue: 'तक्रार नोंदवा',
    allCropsHealthy: 'सर्व पिके निरोगी आणि सुरक्षित आहेत',
    noActionsRequired: 'तूर्तास कोणतीही कामे आवश्यक नाहीत',
    greetingMorning: 'शुभ प्रभात, {name}! 🍃',
    greetingAfternoon: 'नमस्कार, {name}! 🍃',
    greetingEvening: 'शुभ संध्याकाळ, {name}! 🍃',
    happeningToday: 'आज तुमच्या शेतात काय घडत आहे, ते येथे पहा.',
    moistureTipGood: 'उत्तम! तुमच्या शेतात पुरेशी आर्द्रता आहे. नियमित लक्ष ठेवा.',
    moistureTipUrgent: 'महत्त्वाचे: पिकाला सुमारे {amount} मिमी पाण्याची गरज आहे.',
    healthGood: 'कोणतीही मोठी समस्या आढळली नाही. तुमची पिके निरोगी आहेत.',
    healthIssueSingle: '1 पिकाची समस्या नोंदवली गेली आहे. आरोग्य नोंदवही पहा.',
    healthIssuePlural: '{count} पिकांच्या समस्या नोंदवल्या आहेत. आरोग्य नोंदवही पहा.',
    limitedData: 'मर्यादित',
    daysLeft: 'दिवस शिल्लक',
    reportedNearYou: 'तुमच्या परिसरात आढळलेले आजार',
    farmersWithin: '{radius} किमी परिसरातील शेतकऱ्यांनी गेल्या 14 दिवसात या समस्या नोंदवल्या आहेत.',
    checkMyCrop: 'माझे पीक तपासा',
    weatherStale: 'हवामान माहिती उपलब्ध नाही. सेव्ह केलेली माहिती दाखवली जात आहे.',
    irrigationNoData: 'सिंचनाचा सल्ला सध्या उपलब्ध नाही.',
    soilType: 'माती',
    season: 'हंगाम',
    areaHa: '{area} हेक्टर',
    rising: 'वाढत आहे',
    falling: 'घटत आहे',
    stable: 'स्थिर',
    sell: 'विका',
    hold: 'थांबा',
    watch: 'लक्ष ठेवा',
    noPriceData: 'तुमच्या पिकांचे भाव अजून उपलब्ध नाहीत.',
    recentAlerts: 'अलीकडील अलर्ट',
    noAlerts: 'तुमच्या शेतासाठी कोणतेही अलर्ट नाहीत.',
    markAllRead: 'सर्व वाचले म्हणून खुणा करा',
    showLess: 'कमी दाखवा',
    recentIssues: 'अलीकडील समस्या',
    noIssues: 'कोणतीही उघडी समस्या नाही',
    notNeededToday: 'आज गरज नाही',
    applyMm: '{amount} मिमी पाणी द्या',
    rainChance: 'पावसाची {percent}% शक्यता',
    activeIssuesCount: '{count} उघड्या',
    live: 'लाइव्ह',
  },
  bn: {
    soilMoisture: 'মাটির আর্দ্রতা',
    irrigationStatus: 'সেচ পরিস্থিতি',
    sevenDayRainfall: '7-দিনের বৃষ্টিপাত',
    cropHealthScore: 'ফসলের স্বাস্থ্য স্কোর',
    noIrrigation: 'সেচের প্রয়োজন নেই',
    irrigationDue: 'সেচ দিতে হবে',
    notNeeded: 'প্রয়োজন নেই',
    urgent: 'জরুরী',
    low: 'কম',
    moderate: 'মাঝারি',
    high: 'বেশি',
    excellent: 'চমৎকার',
    good: 'ভালো',
    warning: 'সতর্কতা',
    waterIrrigation: 'জল ও সেচ',
    soilWaterUsed: 'ব্যবহৃত জল',
    weatherForecast: 'আবহাওয়ার পূর্বাভাস',
    humidity: 'আর্দ্রতা',
    wind: 'বাতাস',
    updated: 'আপডেট করা',
    priorityAlerts: 'গুরুত্বপূর্ণ সতর্কতা',
    viewAll: 'সব দেখুন',
    overallCropHealth: 'ফসলের সামগ্রিক স্বাস্থ্য',
    quickActions: 'দ্রুত পদক্ষেপ',
    irrigateNow: 'এখনই সেচ দিন',
    startIrrigation: 'সেচ শুরু করুন',
    checkCrop: 'ফসল পরীক্ষা করুন',
    scanDiagnose: 'পরীক্ষা ও সমাধান',
    marketPrices: 'বাজার দর',
    checkLatestPrices: 'তাজা দর দেখুন',
    askAi: 'AI কে জিজ্ঞাসা করুন',
    getFarmingAdvice: 'কৃষি পরামর্শ নিন',
    planAhead: 'ভবিষ্যত পরিকল্পনা',
    whatToPlant: 'কী চাষ করবেন',
    cropsSuited: 'আপনার মাটি, ঋতু এবং আবহাওয়া উপযোগী ফসল সমূহ।',
    planPredict: 'পরিকল্পনা ও অনুমান',
    fertiliserToBuy: 'সার কখন এবং কী পরিমাণ দেবেন, এবং আশানুরূপ ফলন।',
    manage: 'পরিচালনা',
    seeTrends: 'দর দেখুন',
    logIssue: 'সমস্যা জানান',
    allCropsHealthy: 'সব ফসল সুস্থ ও নিরাপদ রয়েছে',
    noActionsRequired: 'কোনো তাত্ক্ষণিক কাজ নেই',
    greetingMorning: 'সুপ্রভাত, {name}! 🍃',
    greetingAfternoon: 'নমস্কার, {name}! 🍃',
    greetingEvening: 'শুভ সন্ধ্যা, {name}! 🍃',
    happeningToday: 'আজ আপনার খামারে কী ঘটছে তা এখানে দেখুন।',
    moistureTipGood: 'দারুণ! আপনার খামারে যথেষ্ট আর্দ্রতা রয়েছে। নিয়মিত তদারকি করুন।',
    moistureTipUrgent: 'গুরুত্বপূর্ণ: ফসলের প্রায় {amount} মিমি জলের প্রয়োজন রয়েছে।',
    healthGood: 'কোনো বড় সমস্যা পাওয়া যায়নি। আপনার ফসলগুলি সুস্থ ও ভালো বাড়ছে।',
    healthIssueSingle: '1টি সমস্যা নথিভুক্ত করা হয়েছে। স্বাস্থ্য রেকর্ড দেখুন।',
    healthIssuePlural: '{count}টি সমস্যা নথিভুক্ত আছে। স্বাস্থ্য রেকর্ড দেখুন।',
    limitedData: 'সীমিত',
    daysLeft: 'দিন বাকি',
    reportedNearYou: 'আপনার আশেপাশে নথিভুক্ত সমস্যা সমূহ',
    farmersWithin: '{radius} কিমি মধ্যে কৃষকরা গত 14 দিনে এই সমস্যাগুলি জানিয়েছেন।',
    checkMyCrop: 'নিজের ফসল দেখুন',
    irrigationNoData: 'সেচের পরামর্শ এই মুহূর্তে পাওয়া যাচ্ছে না।',
    soilType: 'মাটি',
    season: 'ঋতু',
    areaHa: '{area} হেক্টর',
    rising: 'বাড়ছে',
    falling: 'কমছে',
    stable: 'স্থির',
    sell: 'বিক্রি করুন',
    hold: 'অপেক্ষা করুন',
    watch: 'নজর রাখুন',
    noPriceData: 'আপনার ফসলের দর এখনও পাওয়া যাচ্ছে না।',
    recentAlerts: 'সাম্প্রতিক সতর্কতা',
    noAlerts: 'আপনার খামারের জন্য কোনো সতর্কতা নেই।',
    markAllRead: 'সব পড়া হিসেবে চিহ্নিত করুন',
    showLess: 'কম দেখান',
    recentIssues: 'সাম্প্রতিক সমস্যা',
    noIssues: 'কোনো খোলা সমস্যা নেই',
    notNeededToday: 'আজ প্রয়োজন নেই',
    applyMm: '{amount} মিমি জল দিন',
    rainChance: 'বৃষ্টির {percent}% সম্ভাবনা',
    activeIssuesCount: '{count}টি খোলা',
    live: 'লাইভ',
    weatherStale: 'আবহাওয়া তথ্য পাওয়া যাচ্ছে না। সংরক্ষিত তথ্য দেখানো হচ্ছে।',
  },
};

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}

const WEATHER_ICONS = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  fog: CloudFog,
  snow: Snowflake,
} as const;

/** Shown wherever a reading is genuinely unavailable, rather than a stand-in number. */
const NO_VALUE = '—';

/** How often the dashboard re-fetches while left open, in milliseconds. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How often the relative timestamps ("updated 3m ago") are recomputed.
 *
 * Separate from the fetch interval and much shorter: the payload does not
 * change, but a label reading "just now" half an hour later is a lie the page
 * tells simply by sitting still.
 */
const CLOCK_TICK_MS = 30 * 1000;

/** Icon and tone for a market trend direction. */
const DIRECTION_STYLES = {
  RISING: { Icon: TrendingUp, text: 'text-emerald-600', bg: 'bg-emerald-50' },
  FALLING: { Icon: TrendingDown, text: 'text-red-600', bg: 'bg-red-50' },
  STABLE: { Icon: Minus, text: 'text-slate-500', bg: 'bg-slate-50' },
} as const;

function directionStyle(direction: string) {
  return DIRECTION_STYLES[direction as keyof typeof DIRECTION_STYLES] ?? DIRECTION_STYLES.STABLE;
}

/**
 * A trend line plotted from real values.
 *
 * Each of these was previously a fixed `d="M 0 15 Q 15 5, …"` path — the same
 * curve on every farm, every day, moving in a direction unrelated to the number
 * printed beside it. Points are scaled to the series' own range so a flat run of
 * readings renders flat instead of being stretched into invented movement.
 */
function Sparkline({
  values,
  className,
  domain,
}: {
  values: number[];
  className?: string;
  /** Fixed axis, for series like percentages where 0–100 is meaningful. */
  domain?: [number, number];
}) {
  // One point cannot describe a trend, so draw nothing rather than a stub.
  if (values.length < 2) return null;

  const [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  // A zero-height range would divide by zero; centre the line instead.
  const span = hi - lo || 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 18 - ((value - lo) / span) * 16;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  return (
    <svg className={className} viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
      <path
        d={`M ${points.join(' L ')}`}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getCropThumbnail(cropName: string): string {
  const name = cropName.toLowerCase();
  if (['rice', 'wheat', 'maize', 'cotton', 'tomato'].includes(name)) {
    return `/images/crops/${name}.png`;
  }
  return '/images/crops/default_crop.png';
}

function mapLink(category: ActionItem['category']): string {
  switch (category) {
    case 'IRRIGATION':
    case 'WEATHER':
      return '/weather';
    case 'HEALTH':
      return '/health';
    case 'MARKET':
      return '/market';
    case 'SETUP':
      return '/crops';
  }
}

function DashboardContent() {
  const { currentFarm, user } = useAuth();
  const { t, tNarrative, language } = useTranslation();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyOutbreaks | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  /** Alert rows the farmer has cleared this session, so the bell reacts at once. */
  const [readAlertIds, setReadAlertIds] = useState<Set<string>>(new Set());
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [showAllActions, setShowAllActions] = useState(false);
  /**
   * Bumped on a timer purely to re-render the relative timestamps. Nothing reads
   * the value — it exists so "updated 2m ago" keeps counting up on a page the
   * farmer has left open on a phone propped against a fence post.
   */
  const [, setTick] = useState(0);

  const voice = useVoice();

  /**
   * Whether anything is already on screen.
   *
   * A ref rather than reading `data` directly, because `load` must not change
   * identity when the payload does — it is a dependency of the polling effect,
   * and re-creating it every fetch would tear down and rebuild the interval on
   * each tick.
   */
  const hasDataRef = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal, options: { background?: boolean } = {}) => {
      if (!currentFarm) return;
      if (!options.background) setError(null);
      const cacheKey = `dashboard:${currentFarm.id}`;

      try {
        const fresh = await api.dashboard.get(currentFarm.id, signal);
        setData(fresh);
        hasDataRef.current = true;
        setError(null);
        setCacheAge(null);
        writeCache(cacheKey, fresh);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;

        // A failed background poll changes nothing: what is already rendered came
        // from a successful fetch and is newer than anything in the cache. Falling
        // back regardless would raise the "showing saved data" banner over
        // identical numbers, teaching the farmer to distrust a warning that is in
        // fact live. The next tick tries again.
        //
        // A failed *manual* refresh is not silenced — the farmer asked, and is
        // owed an answer either way.
        if (options.background && hasDataRef.current) return;

        const cached = readCache<Dashboard>(cacheKey);
        if (cached) {
          setData(cached.data);
          setCacheAge(describeAge(cached.ageMs));
          return;
        }

        setError({
          message:
            err instanceof ApiError
              ? err.message
              : 'Could not load your dashboard. Please try again.',
          offline: err instanceof ApiError && err.code === 'NETWORK_ERROR',
        });
      }
    },
    [currentFarm],
  );

  const loadNearby = useCallback(() => {
    if (!currentFarm) return;
    api.health
      .nearby(currentFarm.id)
      .then(setNearby)
      .catch(() => setNearby(null));
  }, [currentFarm]);

  useEffect(() => {
    // `load` is re-created when the active farm changes, which is exactly when
    // what is on screen stops belonging to the farm being loaded.
    hasDataRef.current = false;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    loadNearby();
  }, [loadNearby]);

  /**
   * Keep the page live while it is open.
   *
   * Irrigation urgency, weather and mandi prices all move during the day, and a
   * dashboard a farmer opened at dawn was previously still showing dawn's
   * numbers at noon. Three triggers, because they cover different situations:
   * a periodic poll, a return to the tab, and the network coming back.
   *
   * The poll is skipped while the tab is hidden — a backgrounded phone should
   * not be spending the farmer's data — and a refresh fires on the way back in,
   * so nothing is missed by having paused.
   */
  useEffect(() => {
    if (!currentFarm) return;

    const controller = new AbortController();

    const poll = () => {
      if (document.visibilityState === 'hidden') return;
      void load(controller.signal, { background: true });
      loadNearby();
    };

    const interval = window.setInterval(poll, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', poll);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', poll);
      controller.abort();
    };
  }, [currentFarm, load, loadNearby]);

  // Relative timestamps only. Deliberately does not refetch.
  useEffect(() => {
    const interval = window.setInterval(() => setTick((n) => n + 1), CLOCK_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  /**
   * Close the alerts panel on an outside tap or Escape.
   *
   * It is an overlay anchored to the bell, so without this the only way to
   * dismiss it is to find the bell again — awkward on a phone, where the panel
   * covers most of what is behind it.
   */
  const alertsPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!alertsOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!alertsPanelRef.current?.contains(event.target as Node)) setAlertsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAlertsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [alertsOpen]);

  async function refresh() {
    setRefreshing(true);
    await load();
    loadNearby();
    setRefreshing(false);
  }

  /**
   * Mark every alert read.
   *
   * Applied locally first so the bell stops flashing the moment it is tapped,
   * then persisted. A failed write leaves the server state untouched and the
   * next poll restores the badge, which is the right way round: better to be
   * reminded again than to silently lose a warning.
   */
  async function markAlertsRead() {
    if (!currentFarm || !data) return;
    const ids = data.alerts.items.filter((item) => !item.isRead).map((item) => item.id);
    if (ids.length === 0) return;

    setReadAlertIds((previous) => new Set([...previous, ...ids]));
    try {
      await api.alerts.readAll(currentFarm.id);
    } catch {
      // Roll back only what this call claimed. Clearing the whole set would also
      // un-read alerts an earlier, successful call had already persisted.
      setReadAlertIds((previous) => {
        const reverted = new Set(previous);
        for (const id of ids) reverted.delete(id);
        return reverted;
      });
    }
  }

  // `readAloud` closes over `data`, `voice` and the active language, so the
  // listener has to be re-registered when those change. Without a dependency
  // array at all it re-subscribed on every single render instead.
  const readAloudRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handler = () => readAloudRef.current();
    window.addEventListener(READ_ALOUD_EVENT, handler);
    return () => window.removeEventListener(READ_ALOUD_EVENT, handler);
  }, []);

  function readAloud() {
    if (!data) return;
    if (voice.speaking) {
      voice.stop();
      return;
    }

    const briefing = buildSpokenBriefing(
      {
        farmName: data.farm.name,
        actions: data.actions,
        irrigation: data.irrigation,
        weather: data.weather,
      },
      t,
      tNarrative,
    );

    const spoken = voice.resolve(language);
    setVoiceNotice(
      spoken.fellBack
        ? t('voice.noVoiceInstalled', { language: LANGUAGES[language].nativeLabel })
        : null,
    );

    voice.speak(briefing, language);
  }

  readAloudRef.current = readAloud;

  if (!currentFarm) return null;

  if (error && !data) {
    return (
      <ErrorState
        title={error.offline ? 'No connection' : 'Could not load your dashboard'}
        message={error.message}
        offline={error.offline}
        onRetry={() => void load()}
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  // ── Setup translation dictionary index ──
  const dict = DASHBOARD_LOCALES[language] || DASHBOARD_LOCALES['en'];

  // ── Live values, straight from the API ──
  //
  // Every figure below is either a real reading or `null`. Nothing is invented
  // to fill a gap: a card with no data renders NO_VALUE, because a plausible
  // wrong number is worse for a farmer than a visible blank.
  const greeting = getGreeting(dict, user?.name || 'Farmer');
  const current = data.weather.available ? data.weather.current : undefined;

  // Initials for the avatar. Falls back through name → email local part, so a
  // Google account with no display name still gets its own letters rather than
  // the literal placeholder "US" every farmer used to see.
  const initials = avatarInitials(user?.name, user?.email);

  const currentTemp = current
    ? Math.round(current.temperatureC)
    : data.weather.today
      ? Math.round(data.weather.today.tempMaxC)
      : null;
  const weatherDesc = current?.description ?? data.weather.upcoming?.[0]?.description ?? null;
  const humidityVal = current ? Math.round(current.humidityPct) : null;
  const windVal = current ? Math.round(current.windSpeedKmh) : null;

  // The header icon now follows the actual conditions. It was a fixed
  // `CloudSun`, so the widget showed sun-behind-cloud through a thunderstorm —
  // while the five-day strip immediately below it drew the correct icons.
  const CurrentWeatherIcon = weatherDesc ? WEATHER_ICONS[weatherIcon(weatherDesc)] : CloudSun;

  // The provider's observation time when we have one, else when this payload
  // was built. Previously defaulted to the literal string '9:15 AM'.
  const observedAtIso = current?.observedAt ?? data.generatedAt;
  const lastUpdatedFormatted = observedAtIso
    ? new Date(observedAtIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : NO_VALUE;

  // KPI 1: Soil Moisture — computed and clamped server-side.
  const moisturePct = data.irrigation.moisturePercent ?? null;
  const moistureRating =
    moisturePct === null
      ? null
      : moisturePct >= 70
        ? dict.good
        : moisturePct >= 40
          ? dict.moderate
          : dict.low;

  // Observed days feed the moisture card; projected days feed the irrigation
  // card. Two halves of the same modelled series, so neither line is decorative.
  const moistureHistory = (data.irrigation.trend ?? [])
    .filter((day) => day.isPast)
    .map((day) => day.moisturePercent);
  const moistureOutlook = (data.irrigation.trend ?? [])
    .filter((day) => !day.isPast)
    .map((day) => day.moisturePercent);

  // KPI 2: Irrigation Status
  const irrigationStatus = data.irrigation.available
    ? data.irrigation.shouldIrrigate
      ? dict.irrigationDue
      : dict.noIrrigation
    : NO_VALUE;
  const irrigationBadge = data.irrigation.available
    ? data.irrigation.shouldIrrigate
      ? dict.urgent
      : dict.notNeeded
    : null;

  // KPI 3: Total 7-day Rainfall
  const rainfallDays = data.weather.upcoming ?? [];
  const rainfallWeek = rainfallDays.slice(0, 7);
  const totalRainfall = rainfallDays.reduce((sum, day) => sum + (day.rainMm || 0), 0);
  const rainfallBadge =
    rainfallDays.length === 0
      ? null
      : totalRainfall >= 50
        ? dict.high
        : totalRainfall >= 15
          ? dict.moderate
          : dict.low;
  // Bars are scaled against the wettest day of the week. Computed once here
  // rather than inside the render loop, which recalculated it per bar.
  const rainfallPeak = Math.max(...rainfallWeek.map((day) => day.rainMm || 0), 1);

  // KPI 4: Crop Health Score — severity-weighted on the server.
  const healthScore = data.health.score;
  const healthBadge =
    healthScore >= 90 ? dict.excellent : healthScore >= 75 ? dict.good : dict.warning;

  // The irrigation tip, only when there is something real to say.
  const irrigationTip = !data.irrigation.available
    ? null
    : data.irrigation.shouldIrrigate
      ? data.irrigation.depthMm
        ? dict.moistureTipUrgent.replace('{amount}', String(data.irrigation.depthMm))
        : null
      : dict.moistureTipGood;

  // ── Alerts ──
  //
  // `alerts.items` was fetched on every load and thrown away; only the unread
  // count reached the screen, attached to a bell that did nothing. The panel
  // below renders the rows, and the count subtracts anything cleared in this
  // session so the badge responds before the next poll confirms it.
  const alertItems = data.alerts.items.map((item) => ({
    ...item,
    isRead: item.isRead || readAlertIds.has(item.id),
  }));
  const unreadAlerts = alertItems.filter((item) => !item.isRead).length;

  // ── Market ──
  //
  // Also already in the payload and never rendered. The dashboard's market tile
  // read "Check latest prices" whether prices had moved 20% or were unavailable
  // entirely.
  const marketTrends = data.market.available ? data.market.trends : [];
  // Headline mover: the largest absolute weekly swing, since that is the one
  // worth a farmer's attention regardless of which way it went.
  const topMover = marketTrends.reduce<(typeof marketTrends)[number] | null>((best, trend) => {
    if (trend.change7DayPercent === null) return best;
    if (!best || best.change7DayPercent === null) return trend;
    return Math.abs(trend.change7DayPercent) > Math.abs(best.change7DayPercent) ? trend : best;
  }, null);

  // ── Quick action subtitles, driven by the same live figures as the cards ──
  const irrigateHint = !data.irrigation.available
    ? dict.irrigationNoData
    : data.irrigation.shouldIrrigate
      ? data.irrigation.depthMm
        ? dict.applyMm.replace('{amount}', String(data.irrigation.depthMm))
        : dict.startIrrigation
      : dict.notNeededToday;

  const healthHint =
    data.health.activeIssues === 0
      ? dict.noIssues
      : dict.activeIssuesCount.replace('{count}', String(data.health.activeIssues));

  // `topMover` only ever holds a trend with a non-null change, by construction
  // above, but reading it back out keeps that guarantee visible to the compiler.
  const topMoverChange = topMover?.change7DayPercent ?? null;
  const marketHint =
    topMover && topMoverChange !== null
      ? `${cropLabel(topMover.cropName)} ${topMoverChange > 0 ? '+' : ''}${topMoverChange}%`
      : (data.market.message ?? dict.checkLatestPrices);

  // Three actions by default; the rest are one tap away rather than hidden
  // behind a link that pointed back at this same page.
  const visibleActions = showAllActions ? data.actions : data.actions.slice(0, 3);

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ── Top Status/Weather Header Bar ── */}
      <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-3">
        {/* Location Widget */}
        <Card className="flex items-center gap-3 p-4 bg-white/90 shadow-sm border border-soil-150 rounded-2xl">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-sm">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold text-slate-800 text-sm">{data.farm.name}</p>
            <p className="truncate text-xs font-semibold text-slate-500 mt-0.5">
              {data.farm.address ||
                `Lat: ${data.farm.latitude.toFixed(2)}, Lon: ${data.farm.longitude.toFixed(2)}`}
            </p>
            {/*
              Area, soil and season all came back with every dashboard payload
              and none of them were shown. They are the three inputs the farmer
              cannot see anywhere else on this page, and every recommendation
              below is computed from them.
            */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-bold text-slate-500">
              <span className="tabular-nums">
                {dict.areaHa.replace('{area}', String(data.farm.totalAreaHectares))}
              </span>
              {data.farm.soilTypePrimary && (
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3 text-soil-400" aria-hidden />
                  {humanise(data.farm.soilTypePrimary)}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3 text-brand-500" aria-hidden />
                {humanise(data.farm.season)}
              </span>
            </div>
          </div>
        </Card>

        {/* Live Weather Widget */}
        <Card className="flex items-center justify-between p-4 bg-white/90 shadow-sm border border-soil-150 rounded-2xl">
          <div className="flex items-center gap-2.5">
            <CurrentWeatherIcon className="h-8 w-8 text-amber-500 shrink-0" aria-hidden />
            <div>
              <p className="font-extrabold text-slate-800 text-sm">
                {currentTemp === null ? NO_VALUE : `${currentTemp}°C`}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 truncate max-w-[80px]">
                {weatherDesc ?? NO_VALUE}
              </p>
            </div>
          </div>
          <div className="h-8 w-[1px] bg-slate-200" />
          <div className="text-center">
            <p className="text-xs font-bold text-slate-700">
              {humidityVal === null ? NO_VALUE : `${humidityVal}%`}
            </p>
            <p className="text-[9px] font-semibold text-slate-400">{dict.humidity}</p>
          </div>
          <div className="h-8 w-[1px] bg-slate-200" />
          <div className="text-center">
            <p className="text-xs font-bold text-slate-700">
              {windVal === null ? NO_VALUE : `${windVal} km/h`}
            </p>
            <p className="text-[9px] font-semibold text-slate-400">{dict.wind}</p>
          </div>
          <div className="h-8 w-[1px] bg-slate-200" />
          <div className="text-right">
            <p className="text-xs font-bold text-slate-700">{lastUpdatedFormatted}</p>
            <p className="text-[9px] font-semibold text-slate-400">{dict.updated}</p>
          </div>
        </Card>

        {/* Profile Card */}
        {/* The ref sits on a wrapper because `Card` is a plain function
            component and cannot receive one. */}
        <div ref={alertsPanelRef} className="relative">
          <Card className="relative flex h-full items-center justify-between p-4 bg-white/90 shadow-sm border border-soil-150 rounded-2xl">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative h-10 w-10 shrink-0 rounded-xl overflow-hidden bg-brand-100 border border-brand-200 flex items-center justify-center text-brand-700 font-extrabold">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate font-extrabold text-slate-800 text-sm">
                  {user?.name || 'Farmer'}
                </p>
                <p className="truncate text-xs font-semibold text-brand-600 mt-0.5">
                  {data.farm.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/*
              Counts unread alerts, not open actions. `alerts.unread` is what the
              API already tracks as "not yet seen"; `actions.length` is the
              always-populated to-do list, so keying off it lit the dot
              permanently and made it meaningless.

              The button now opens the alert rows it is counting. Before, tapping
              it did nothing at all — the badge was the only part of the alerts
              payload that reached the screen.
            */}
              <button
                type="button"
                onClick={() => setAlertsOpen((open) => !open)}
                aria-expanded={alertsOpen}
                className={cn(
                  'relative h-9 w-9 flex items-center justify-center rounded-xl border transition-colors',
                  alertsOpen
                    ? 'bg-brand-50 border-brand-200'
                    : 'bg-slate-50 border-slate-100 hover:bg-slate-100',
                )}
                aria-label={unreadAlerts > 0 ? `${unreadAlerts} unread alerts` : dict.recentAlerts}
              >
                <Bell className="h-4.5 w-4.5 text-slate-600" aria-hidden />
                {unreadAlerts > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
            </div>

            {alertsOpen && (
              <div className="absolute right-3 top-[calc(100%-0.25rem)] z-30 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-soil-150 bg-white p-3 shadow-lg">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    {dict.recentAlerts}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {unreadAlerts > 0 && (
                      <button
                        type="button"
                        onClick={() => void markAlertsRead()}
                        className="text-[10px] font-extrabold text-brand-700 hover:text-brand-800"
                      >
                        {dict.markAllRead}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAlertsOpen(false)}
                      // `close` lives under the voice namespace — that is where the
                      // only existing translation of the word is.
                      aria-label={t('voice.close')}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                {alertItems.length === 0 ? (
                  <p className="py-3 text-center text-xs font-semibold text-slate-500">
                    {dict.noAlerts}
                  </p>
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-y-auto">
                    {alertItems.map((item) => {
                      const style = severityStyles[item.severity] ?? severityStyles.INFO;
                      return (
                        <li
                          key={item.id}
                          className={cn(
                            'rounded-xl border px-2.5 py-2',
                            style.bg,
                            style.border,
                            item.isRead && 'opacity-60',
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot)}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <p className={cn('text-xs font-extrabold', style.text)}>
                                {item.title ?? humanise(item.alertType)}
                              </p>
                              <p className="mt-0.5 text-[11px] font-semibold leading-snug text-slate-600">
                                {item.message}
                              </p>
                              {item.action && (
                                <p className="mt-1 text-[10px] font-bold text-slate-500">
                                  {item.action}
                                </p>
                              )}
                              <p className="mt-1 text-[10px] font-semibold text-slate-400">
                                {timeAgo(item.createdAt)}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Greeting & Refresh ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500/90 drop-shadow-sm">
            {greeting}
          </p>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight drop-shadow-sm mt-0.5">
            {dict.happeningToday}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/*
            Says out loud that the page refreshes itself. Without it, the manual
            refresh button reads as the only way to get new numbers, and a farmer
            watching an irrigation warning has no reason to believe the figure in
            front of them is current.
          */}
          {!cacheAge && (
            <span
              className="hidden items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50/70 px-2.5 py-2 text-xs font-extrabold text-emerald-700 sm:inline-flex"
              title={`${dict.updated} ${timeAgo(data.generatedAt)}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
              {dict.live}
            </span>
          )}
          {voice.supported && (
            <button
              type="button"
              onClick={readAloud}
              aria-label={voice.speaking ? t('voice.stopReading') : t('voice.readAloud')}
              className={cn(
                'btn-secondary px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 shadow-sm border border-soil-200 bg-white hover:bg-slate-50 transition-all duration-200',
                voice.speaking && 'text-brand-700 border-brand-300',
              )}
            >
              {voice.speaking ? (
                <Square className="h-4 w-4 fill-current animate-pulse" aria-hidden />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden />
              )}
              {voice.speaking
                ? t('voice.stopReading').split(' ')[0]
                : t('voice.readAloud').split(' ')[0]}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label={t('common.refresh')}
            className="btn-secondary px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 shadow-sm border border-soil-200 bg-white hover:bg-slate-50 transition-all duration-200"
          >
            <RefreshCw
              className={cn('h-4 w-4 text-slate-600', refreshing && 'animate-spin')}
              aria-hidden
            />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {voiceNotice && <Notice tone="warn">{voiceNotice}</Notice>}
      {cacheAge && <Notice tone="warn">{dict.weatherStale}</Notice>}
      {error && <Notice tone="warn">{error.message}</Notice>}
      {data.weather.warning && <Notice tone="warn">{data.weather.warning}</Notice>}

      {/* ── 4 Mini KPI Stats Cards Row ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Soil Moisture */}
        <Card className="p-4 bg-white/95 border border-soil-150/70 shadow-sm rounded-2xl flex flex-col justify-between overflow-hidden h-28 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">{dict.soilMoisture}</span>
            <Droplets className="h-4.5 w-4.5 text-blue-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800">
              {moisturePct === null ? NO_VALUE : `${moisturePct}%`}
            </span>
            {moistureRating && (
              <span
                className={cn(
                  'text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md',
                  moisturePct !== null && moisturePct >= 70
                    ? 'text-blue-600 bg-blue-50'
                    : moisturePct !== null && moisturePct >= 40
                      ? 'text-amber-600 bg-amber-50'
                      : 'text-red-600 bg-red-50',
                )}
              >
                {moistureRating}
              </span>
            )}
          </div>
          {/* Observed root-zone moisture, day by day */}
          <div className="absolute bottom-0 left-0 w-full px-2 opacity-80 z-0">
            <Sparkline
              values={moistureHistory}
              domain={[0, 100]}
              className="w-full h-8 text-blue-400"
            />
          </div>
        </Card>

        {/* KPI 2: Irrigation Status */}
        <Card className="p-4 bg-white/95 border border-soil-150/70 shadow-sm rounded-2xl flex flex-col justify-between overflow-hidden h-28 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">{dict.irrigationStatus}</span>
            <Sprout className="h-4.5 w-4.5 text-emerald-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-lg font-black text-slate-800 truncate max-w-[100px]">
              {irrigationStatus}
            </span>
            {irrigationBadge && (
              <span
                className={cn(
                  'text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md',
                  data.irrigation.shouldIrrigate
                    ? 'text-red-600 bg-red-50 animate-pulse'
                    : 'text-emerald-600 bg-emerald-50',
                )}
              >
                {irrigationBadge}
              </span>
            )}
          </div>
          {/* Projected moisture over the coming days — where the balance is heading */}
          <div className="absolute bottom-0 left-0 w-full px-2 opacity-80 z-0">
            <Sparkline
              values={moistureOutlook}
              domain={[0, 100]}
              className="w-full h-8 text-emerald-400"
            />
          </div>
        </Card>

        {/* KPI 3: Rainfall */}
        <Card className="p-4 bg-white/95 border border-soil-150/70 shadow-sm rounded-2xl flex flex-col justify-between overflow-hidden h-28 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">{dict.sevenDayRainfall}</span>
            <CloudRain className="h-4.5 w-4.5 text-purple-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800">
              {rainfallDays.length === 0 ? NO_VALUE : `${totalRainfall.toFixed(0)} mm`}
            </span>
            {rainfallBadge && (
              <span className="text-[10px] font-extrabold text-purple-600 uppercase bg-purple-50 px-1.5 py-0.5 rounded-md">
                {rainfallBadge}
              </span>
            )}
          </div>
          {/* Daily rainfall bars — already real data, scaled against the
              wettest day so a light week is not flattened to nothing. */}
          <div className="absolute bottom-1 left-0 w-full px-4 opacity-50 z-0 flex justify-between items-end h-6">
            {rainfallWeek.map((day) => (
              <div
                key={day.date}
                className="w-1.5 bg-purple-500 rounded-t-sm"
                title={`${formatDay(day.date)}: ${(day.rainMm || 0).toFixed(1)} mm`}
                style={{ height: `${Math.max(2, ((day.rainMm || 0) / rainfallPeak) * 24)}px` }}
              />
            ))}
          </div>
        </Card>

        {/* KPI 4: Crop Health Score */}
        <Card className="p-4 bg-white/95 border border-soil-150/70 shadow-sm rounded-2xl flex flex-col justify-between overflow-hidden h-28 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">{dict.cropHealthScore}</span>
            <Stethoscope className="h-4.5 w-4.5 text-emerald-500" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800">{healthScore}/100</span>
            <span
              className={cn(
                'text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md',
                healthScore >= 90
                  ? 'text-emerald-600 bg-emerald-50'
                  : healthScore >= 75
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-amber-600 bg-amber-50 animate-pulse',
              )}
            >
              {healthBadge}
            </span>
          </div>
          {/*
            One segment per open issue, coloured by severity — this is what the
            score above is built from, so the card shows its own working.

            Health has no time series to plot: `health_logs` records when an
            issue was observed but never when it was resolved, so a trend line
            here would have to be invented. A breakdown is the honest chart for
            the data that exists.
          */}
          <div className="absolute bottom-2 left-0 w-full px-4 z-0 flex items-end gap-1 h-5">
            {data.health.recent.map((issue) => (
              <div
                key={issue.id}
                title={`${cropLabel(issue.cropName)}: ${humanise(issue.severity)}`}
                className={cn(
                  'flex-1 rounded-sm',
                  issue.severity === 'CRITICAL'
                    ? 'bg-red-500 h-5'
                    : issue.severity === 'SEVERE'
                      ? 'bg-orange-400 h-4'
                      : issue.severity === 'MODERATE'
                        ? 'bg-amber-300 h-3'
                        : 'bg-emerald-300 h-2',
                )}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* ── Main Dashboard Content Cards Grid ── */}
      <div className="grid gap-6 md:grid-cols-12">
        {/* Left Widget: Water & Irrigation (7 cols) */}
        <div className="md:col-span-7">
          <Link href="/weather" className="block h-full">
            <Card
              className={cn(
                'h-full p-6 transition-all duration-300 hover:shadow-md hover:border-brand-300 relative overflow-hidden bg-white/90 border border-soil-150 rounded-2xl flex flex-col justify-between',
                data.irrigation.shouldIrrigate &&
                  'border-red-200 bg-gradient-to-br from-orange-50/20 via-red-50/10 to-white shadow-sm shadow-red-50',
              )}
            >
              <div>
                <SectionHeading icon={Droplets} title={dict.waterIrrigation} />
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  {/* Gauge and details block */}
                  <div className="flex-1 space-y-3">
                    <p
                      className={cn(
                        'text-lg font-black tracking-tight',
                        data.irrigation.shouldIrrigate ? 'text-red-950' : 'text-slate-800',
                      )}
                    >
                      {data.irrigation.headline ||
                        (data.irrigation.shouldIrrigate ? dict.irrigationDue : dict.noIrrigation)}
                    </p>
                    {/*
                      No invented fallback sentence here. The old one claimed
                      "soil moisture is good … rain expected over the coming
                      week" whenever the engine returned nothing — which is
                      exactly when nobody knows whether either is true.
                    */}
                    <p className="text-base text-slate-600 leading-relaxed font-medium">
                      {data.irrigation.reason ?? data.irrigation.warning ?? dict.irrigationNoData}
                    </p>
                  </div>
                  {/* Circular SVG progress ring */}
                  <div className="relative flex shrink-0 items-center justify-center w-24 h-24 self-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-slate-100"
                        strokeWidth="3.2"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-blue-500"
                        strokeWidth="3.2"
                        // No reading means no arc — an empty ring, rather than
                        // a full one implying perfectly wet soil.
                        strokeDasharray={`${moisturePct ?? 0}, 100`}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-lg font-black text-slate-800">
                        {moisturePct === null ? NO_VALUE : `${moisturePct}%`}
                      </span>
                      <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">
                        {dict.soilMoisture.split(' ')[0]}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress bar and tip */}
              <div className="mt-6 space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-600">
                    <span>{dict.soilWaterUsed}</span>
                    <span className="font-extrabold">{data.irrigation.depletionPercent ?? 0}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100 p-0.5 border border-slate-200/50">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        (data.irrigation.depletionPercent ?? 0) >= 75
                          ? 'bg-gradient-to-r from-red-500 to-rose-600'
                          : 'bg-gradient-to-r from-blue-500 to-sky-600',
                      )}
                      style={{ width: `${Math.min(100, data.irrigation.depletionPercent ?? 0)}%` }}
                    />
                  </div>
                </div>

                {/*
                  Only shown when the engine actually produced a depth. The
                  previous `|| 20` meant a farmer could be told to apply
                  "about 20 mm" on a day the model had computed nothing.
                */}
                {irrigationTip && (
                  <div className="p-3 bg-blue-50/70 border border-blue-100/50 rounded-xl flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                    <p className="text-xs font-bold text-blue-800">{irrigationTip}</p>
                  </div>
                )}
              </div>
            </Card>
          </Link>
        </div>

        {/* Right Widget: Weather Forecast (5 cols) */}
        <div className="md:col-span-5">
          <Link href="/weather" className="block h-full">
            <Card className="h-full p-6 transition-all duration-300 hover:shadow-md hover:border-brand-300 bg-white/90 border border-soil-150 rounded-2xl flex flex-col justify-between relative overflow-hidden">
              {/* Premium illustrated backdrop of rolling hills */}
              <div className="absolute right-0 top-0 w-36 h-28 pointer-events-none opacity-40 z-0">
                <svg
                  viewBox="0 0 100 80"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full"
                >
                  <circle cx="75" cy="25" r="8" fill="#FBBF24" opacity="0.6" />
                  <path
                    d="M 0 60 Q 30 45, 60 60 T 100 55 L 100 80 L 0 80 Z"
                    fill="#10B981"
                    opacity="0.15"
                  />
                  <path
                    d="M 20 65 Q 50 55, 80 65 T 100 62 L 100 80 L 20 80 Z"
                    fill="#047857"
                    opacity="0.2"
                  />
                  <circle cx="20" cy="50" r="1.5" fill="#34D399" />
                  <circle cx="25" cy="53" r="1" fill="#34D399" />
                  <circle cx="85" cy="52" r="2" fill="#047857" />
                </svg>
              </div>

              <div className="relative z-10">
                <SectionHeading icon={CloudSun} title={dict.weatherForecast} />
                {data.weather.today && (
                  <div className="mt-3 flex items-start gap-4">
                    <div>
                      <p className="text-3xl font-extrabold tabular-nums text-slate-900">
                        {Math.round(data.weather.today.tempMaxC)}°
                        <span className="ml-1 text-lg font-bold text-slate-400">
                          / {Math.round(data.weather.today.tempMinC)}°
                        </span>
                      </p>
                      <p className="text-sm font-bold text-slate-800 mt-1">{weatherDesc}</p>
                      <p className="text-xs font-semibold text-slate-500 mt-0.5">
                        {data.weather.today.rainMm > 0
                          ? `${data.weather.today.rainMm.toFixed(0)} mm rain expected today`
                          : 'No rain expected today'}
                      </p>
                      {/*
                        Rain probability arrives with every forecast and was
                        dropped on the floor. "4 mm expected" reads very
                        differently at 30% confidence than at 90%, and that
                        difference decides whether irrigating today is wasted.
                      */}
                      {data.weather.today.rainProbability !== null && (
                        <p className="text-xs font-bold text-blue-600 mt-0.5 tabular-nums">
                          {dict.rainChance.replace(
                            '{percent}',
                            String(Math.round(data.weather.today.rainProbability)),
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 5-day grid */}
              <div className="grid grid-cols-5 gap-2 mt-6 relative z-10">
                {data.weather.upcoming?.slice(0, 5).map((day) => {
                  const Icon = WEATHER_ICONS[weatherIcon(day.description)] || Cloud;
                  return (
                    <div
                      key={day.date}
                      className="flex flex-col items-center gap-1.5 rounded-xl py-2 px-1.5 bg-white/70 border border-slate-100 shadow-sm backdrop-blur-[1px]"
                    >
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase">
                        {formatDay(day.date)}
                      </span>
                      <Icon className="h-4.5 w-4.5 text-brand-600" aria-hidden />
                      <span className="text-xs font-extrabold tabular-nums text-slate-800">
                        {Math.round(day.tempMaxC)}°
                      </span>
                      {day.rainMm > 0 ? (
                        <span className="text-[9px] font-extrabold tabular-nums text-blue-600">
                          {day.rainMm.toFixed(0)}mm
                        </span>
                      ) : (
                        <span className="text-[9px] text-slate-400 font-bold">-</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* ── Bottom Row (3 Columns) ── */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Col 1: Priority Alerts */}
        <section className="flex flex-col h-full justify-between">
          {/*
            "View all" used to be a Link to /dashboard — this very page — so it
            appeared to offer more and did nothing. It now expands the list,
            which is where the remaining actions actually are, and only appears
            when there is something beyond the three on show.
          */}
          <SectionHeading
            icon={Bell}
            title={dict.priorityAlerts}
            action={
              data.actions.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setShowAllActions((shown) => !shown)}
                  className="text-base font-extrabold text-brand-700 hover:text-brand-800 transition-colors drop-shadow-sm"
                >
                  {showAllActions ? dict.showLess : `${dict.viewAll} (${data.actions.length})`}
                </button>
              ) : undefined
            }
          />
          <div className="space-y-3 flex-1">
            {data.actions.length === 0 ? (
              <Card className="p-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 flex items-center gap-3 shadow-sm h-full justify-center">
                <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-emerald-950">{dict.allCropsHealthy}</p>
                  <p className="text-xs font-semibold text-emerald-800/80 mt-0.5">
                    {dict.noActionsRequired}
                  </p>
                </div>
              </Card>
            ) : (
              visibleActions.map((action) => {
                const Icon =
                  {
                    IRRIGATION: Droplets,
                    WEATHER: CloudSun,
                    HEALTH: Stethoscope,
                    MARKET: TrendingUp,
                    SETUP: Sprout,
                  }[action.category] || Sprout;
                const link = mapLink(action.category);

                return (
                  <Link key={action.id} href={link}>
                    <Card
                      className={cn(
                        'p-4 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-3 shadow-sm hover:border-brand-300 hover:shadow-md',
                        action.priority === 'CRITICAL' || action.priority === 'HIGH'
                          ? 'border-red-100 bg-red-50/40 text-slate-800'
                          : action.priority === 'MEDIUM'
                            ? 'border-amber-100 bg-amber-50/40 text-slate-800'
                            : 'border-blue-100 bg-blue-50/40 text-slate-800',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                            action.priority === 'CRITICAL' || action.priority === 'HIGH'
                              ? 'bg-red-100 text-red-600'
                              : action.priority === 'MEDIUM'
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-blue-100 text-blue-600',
                          )}
                        >
                          <Icon className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-extrabold truncate text-slate-800">
                            {action.title}
                          </p>
                          <p className="text-xs font-semibold truncate mt-0.5 text-slate-500">
                            {action.detail}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </Card>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        {/* Col 2: Crop Health */}
        <section className="flex flex-col h-full justify-between">
          <SectionHeading
            icon={Stethoscope}
            title={t('health.title')}
            action={
              <Link
                href="/health"
                className="text-base font-extrabold text-brand-700 hover:text-brand-800 transition-colors drop-shadow-sm"
              >
                {dict.logIssue}
              </Link>
            }
          />
          <Card className="p-6 bg-white/95 border border-soil-150 rounded-2xl flex-1 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between gap-6">
              {/* Circular health score gauge */}
              <div className="relative flex shrink-0 items-center justify-center w-24 h-24">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-slate-100"
                    strokeWidth="3.2"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="text-emerald-500"
                    strokeWidth="3.2"
                    strokeDasharray={`${healthScore}, 100`}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-xl font-black text-slate-800">{healthScore}</span>
                  <span className="text-[10px] font-extrabold text-slate-400">/100</span>
                </div>
              </div>

              {/* Status and text details */}
              <div className="flex-1 space-y-1.5">
                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                  {dict.overallCropHealth}
                </p>
                <Badge
                  tone={healthScore >= 90 ? 'success' : healthScore >= 75 ? 'warn' : 'neutral'}
                  className="text-[10px] font-extrabold tracking-wide uppercase px-2 py-0.5"
                >
                  {healthBadge}
                </Badge>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed mt-1">
                  {data.health.activeIssues === 0
                    ? dict.healthGood
                    : data.health.activeIssues === 1
                      ? dict.healthIssueSingle
                      : dict.healthIssuePlural.replace('{count}', String(data.health.activeIssues))}
                </p>
              </div>
            </div>

            {/*
              The open issues themselves. `health.recent` was already fetched and
              only ever used to draw five anonymous severity bars on the KPI card
              above — the farmer could see that something was wrong but not what,
              or on which crop.
            */}
            {data.health.recent.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-soil-100 pt-3">
                {data.health.recent.slice(0, 3).map((issue) => (
                  <li key={issue.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-extrabold text-slate-700">
                        {cropLabel(issue.cropName)}
                        <span className="font-semibold text-slate-500"> · {issue.summary}</span>
                      </p>
                      <p className="text-[10px] font-semibold text-slate-400">
                        {timeAgo(issue.observedAt)}
                      </p>
                    </div>
                    <Badge
                      tone={
                        issue.severity === 'CRITICAL'
                          ? 'danger'
                          : issue.severity === 'SEVERE'
                            ? 'warn'
                            : 'neutral'
                      }
                      className="shrink-0 text-[9px] font-extrabold uppercase"
                    >
                      {humanise(issue.severity)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            <Link
              href="/health"
              className="btn-secondary w-full py-2.5 rounded-xl text-sm font-extrabold border border-soil-200 hover:bg-slate-50 mt-4 text-center shadow-sm"
            >
              {t('health.logObservation').split(' ')[0]}
            </Link>
          </Card>
        </section>

        {/* Col 3: Quick Actions */}
        <section className="flex flex-col h-full justify-between">
          <SectionHeading icon={Sparkles} title={dict.quickActions} />
          {/*
            The four tiles are still fixed destinations — they are navigation —
            but their captions now report live state instead of restating the
            title. "Irrigate Now / Start irrigation" said the same thing twice
            and looked identical on a day the model had computed that no water
            was needed at all.
          */}
          <div className="grid grid-cols-2 gap-3 flex-1">
            {/* Quick Action 1: Irrigate */}
            <Link href="/weather" className="block h-full">
              <Card
                className={cn(
                  'p-4 bg-blue-50/50 hover:bg-blue-50 border border-blue-100 shadow-sm rounded-2xl flex flex-col justify-between h-full hover:shadow-md transition-all duration-300',
                  data.irrigation.shouldIrrigate &&
                    'border-blue-300 bg-blue-50 ring-1 ring-blue-200',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 shadow-inner">
                    <Droplets className="h-4.5 w-4.5" />
                  </div>
                  {data.irrigation.shouldIrrigate && (
                    <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-red-700">
                      {dict.urgent}
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <p className="text-sm font-extrabold text-blue-950">{dict.irrigateNow}</p>
                  <p className="text-[10px] font-bold text-blue-800 mt-0.5 line-clamp-2">
                    {irrigateHint}
                  </p>
                </div>
              </Card>
            </Link>

            {/* Quick Action 2: Check Crop */}
            <Link href="/health" className="block h-full">
              <Card
                className={cn(
                  'p-4 bg-emerald-50/50 hover:bg-emerald-50 border border-emerald-100 shadow-sm rounded-2xl flex flex-col justify-between h-full hover:shadow-md transition-all duration-300',
                  data.health.activeIssues > 0 &&
                    'border-amber-200 bg-amber-50/60 hover:bg-amber-50',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div
                    className={cn(
                      'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 shadow-inner',
                      data.health.activeIssues > 0
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-600',
                    )}
                  >
                    <Stethoscope className="h-4.5 w-4.5" />
                  </div>
                  {data.health.activeIssues > 0 && (
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-800 tabular-nums">
                      {data.health.activeIssues}
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <p
                    className={cn(
                      'text-sm font-extrabold',
                      data.health.activeIssues > 0 ? 'text-amber-950' : 'text-emerald-950',
                    )}
                  >
                    {dict.checkCrop}
                  </p>
                  <p
                    className={cn(
                      'text-[10px] font-bold mt-0.5 line-clamp-2',
                      data.health.activeIssues > 0 ? 'text-amber-800' : 'text-emerald-800',
                    )}
                  >
                    {healthHint}
                  </p>
                </div>
              </Card>
            </Link>

            {/* Quick Action 3: Market Prices */}
            <Link href="/market" className="block h-full">
              <Card className="p-4 bg-purple-50/50 hover:bg-purple-50 border border-purple-100 shadow-sm rounded-2xl flex flex-col justify-between h-full hover:shadow-md transition-all duration-300">
                <div className="flex items-start justify-between gap-1">
                  <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0 shadow-inner">
                    <TrendingUp className="h-4.5 w-4.5" />
                  </div>
                  {topMover && (
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase',
                        directionStyle(topMover.direction).bg,
                        directionStyle(topMover.direction).text,
                      )}
                    >
                      {topMover.direction === 'RISING'
                        ? dict.rising
                        : topMover.direction === 'FALLING'
                          ? dict.falling
                          : dict.stable}
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <p className="text-sm font-extrabold text-purple-950">{dict.marketPrices}</p>
                  <p className="text-[10px] font-bold text-purple-800 mt-0.5 line-clamp-2">
                    {marketHint}
                  </p>
                </div>
              </Card>
            </Link>

            {/* Quick Action 4: Ask AI */}
            <Link href="/recommendations" className="block h-full">
              <Card className="p-4 bg-orange-50/50 hover:bg-orange-50 border border-orange-100 shadow-sm rounded-2xl flex flex-col justify-between h-full hover:shadow-md transition-all duration-300">
                <div className="h-9 w-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 shadow-inner">
                  <Sparkles className="h-4.5 w-4.5" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-extrabold text-orange-950">{dict.askAi}</p>
                  <p className="text-[10px] font-bold text-orange-800 mt-0.5">
                    {dict.getFarmingAdvice}
                  </p>
                </div>
              </Card>
            </Link>
          </div>
        </section>
      </div>

      {/* ── Your Crops List Section ── */}
      <section className="mt-6">
        <SectionHeading
          icon={Sprout}
          title={t('nav.crops')}
          action={
            <Link
              href="/crops"
              className="text-base font-extrabold text-brand-700 hover:text-brand-800 transition-colors drop-shadow-sm"
            >
              {dict.manage}
            </Link>
          }
        />
        {data.crops.length === 0 ? (
          <Card className="p-5 text-center">
            <p className="text-base font-medium text-slate-600">{t('crops.emptyCrops')}</p>
            <Link
              href="/crops"
              className="btn-primary mt-3 w-full sm:w-auto text-center inline-block"
            >
              {t('crops.addCrop')}
            </Link>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {data.crops.map((crop) => {
              const imageUrl = getCropThumbnail(crop.cropName);
              return (
                <Card
                  key={crop.id}
                  className="flex items-center gap-3.5 p-4 hover:shadow-md transition-shadow duration-300 bg-white/90 border border-soil-150 rounded-2xl"
                >
                  <div className="relative w-12 h-12 shrink-0 rounded-xl overflow-hidden shadow-inner border border-soil-100 bg-soil-50">
                    <Image
                      src={imageUrl}
                      alt={crop.cropName}
                      fill
                      sizes="48px"
                      className="object-cover animate-fade-in"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-slate-800 text-sm">
                      {cropLabel(crop.cropName)}
                    </p>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">
                      {humanise(crop.growthStage) || humanise(crop.status)}
                      {crop.daysToHarvest !== null && crop.daysToHarvest > 0
                        ? ` · ${crop.daysToHarvest} ${dict.daysLeft}`
                        : ''}
                    </p>
                  </div>
                  {!crop.isRecognised ? (
                    <Badge tone="warn" className="shrink-0 text-[9px] font-extrabold">
                      {dict.limitedData}
                    </Badge>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Market Prices ── */}
      {/*
        `data.market` has been part of the dashboard payload all along: a mandi
        price, direction, weekly change and sell/hold signal for each of the
        farm's crops. None of it was rendered. The dashboard even raises MARKET
        action items from these same trends, so a farmer could be told "good time
        to sell" with no price anywhere on the page to judge it against.
      */}
      <section className="mt-6">
        <SectionHeading
          icon={TrendingUp}
          title={dict.marketPrices}
          action={
            <Link
              href="/market"
              className="text-base font-extrabold text-brand-700 hover:text-brand-800 transition-colors drop-shadow-sm"
            >
              {dict.viewAll}
            </Link>
          }
        />
        {marketTrends.length === 0 ? (
          <Card className="p-5 text-center bg-white/90 border border-soil-150 rounded-2xl">
            <p className="text-sm font-semibold text-slate-600">
              {data.market.message ?? dict.noPriceData}
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {marketTrends.map((trend) => {
              const style = directionStyle(trend.direction);
              const signalLabel =
                trend.signal === 'SELL'
                  ? dict.sell
                  : trend.signal === 'HOLD'
                    ? dict.hold
                    : dict.watch;

              return (
                <Link key={trend.commodity} href="/market" className="block h-full">
                  <Card className="flex h-full flex-col justify-between gap-3 p-4 bg-white/90 border border-soil-150 rounded-2xl shadow-sm transition-all duration-300 hover:border-brand-300 hover:shadow-md">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-800">
                          {cropLabel(trend.cropName)}
                        </p>
                        <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {trend.commodity}
                        </p>
                      </div>
                      <Badge
                        tone={
                          trend.signal === 'SELL'
                            ? 'success'
                            : trend.signal === 'HOLD'
                              ? 'warn'
                              : 'neutral'
                        }
                        className="shrink-0 text-[9px] font-extrabold uppercase"
                      >
                        {signalLabel}
                      </Badge>
                    </div>

                    <div className="flex items-end justify-between gap-2">
                      <div>
                        {/* No price means no price. The previous market tile
                            simply said "Check latest prices" either way. */}
                        <p className="text-xl font-black tabular-nums text-slate-900">
                          {trend.currentPrice === null
                            ? NO_VALUE
                            : formatRupees(trend.currentPrice)}
                        </p>
                        <p className="text-[10px] font-semibold text-slate-400">{trend.unit}</p>
                      </div>
                      <div
                        className={cn(
                          'flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-extrabold tabular-nums',
                          style.bg,
                          style.text,
                        )}
                      >
                        <style.Icon className="h-3.5 w-3.5" aria-hidden />
                        {trend.change7DayPercent === null
                          ? NO_VALUE
                          : `${trend.change7DayPercent > 0 ? '+' : ''}${trend.change7DayPercent}%`}
                      </div>
                    </div>

                    <p className="text-xs font-semibold leading-snug text-slate-500 line-clamp-2">
                      {tNarrative(trend.headline)}
                    </p>

                    {/* Seeded rows are demo figures, not a real mandi quote —
                        saying so is the difference between a price a farmer can
                        act on and one they cannot. */}
                    {trend.isSeeded && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase text-amber-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {dict.limitedData}
                      </span>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Plan Ahead Sections ── */}
      <section className="mt-6">
        <SectionHeading title={dict.planAhead} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/recommendations">
            <Card className="flex h-full items-start gap-4 p-5 transition-all duration-300 hover:border-brand-300 bg-white/90 border border-soil-150 rounded-2xl hover:shadow-md">
              <div className="h-10 w-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 shadow-inner">
                <Sprout className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold text-slate-800">{dict.whatToPlant}</p>
                <p className="text-sm font-semibold text-slate-500 mt-1">{dict.cropsSuited}</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400 self-center" aria-hidden />
            </Card>
          </Link>

          <Link href="/planning">
            <Card className="flex h-full items-start gap-4 p-5 transition-all duration-300 hover:border-brand-300 bg-white/90 border border-soil-150 rounded-2xl hover:shadow-md">
              <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 shadow-inner">
                <Droplets className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-extrabold text-slate-800">{dict.planPredict}</p>
                <p className="text-sm font-semibold text-slate-500 mt-1">{dict.fertiliserToBuy}</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400 self-center" aria-hidden />
            </Card>
          </Link>
        </div>
      </section>

      {/* ── Outbreak Signal Section ── */}
      {nearby && nearby.outbreaks.length > 0 && (
        <section className="mt-6">
          <SectionHeading icon={Users} title={dict.reportedNearYou} />
          <Card className="border-amber-200 bg-amber-50/70 p-5 rounded-2xl shadow-sm">
            <p className="text-base font-bold text-amber-950">
              {dict.farmersWithin.replace('{radius}', String(nearby.radiusKm))}
            </p>
            <div className="mt-4 space-y-2">
              {nearby.outbreaks.slice(0, 3).map((outbreak) => (
                <div
                  key={`${outbreak.name}-${outbreak.crop}`}
                  className="flex items-center justify-between gap-2 border-b border-amber-200/40 pb-2 last:border-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-sm font-extrabold text-amber-950">
                    {outbreak.name}
                    <span className="font-semibold text-amber-900/80">
                      {' '}
                      {t('health.onCrop')} {cropLabel(outbreak.crop)}
                    </span>
                  </span>
                  <Badge tone="warn" className="shrink-0 text-xs font-extrabold">
                    {outbreak.count} farm{outbreak.count === 1 ? '' : 's'}
                  </Badge>
                </div>
              ))}
            </div>
            <Link
              href="/health"
              className="btn-primary mt-4 w-full sm:w-auto py-2.5 rounded-xl shadow-sm text-center inline-block"
            >
              {dict.checkMyCrop}
            </Link>
          </Card>
        </section>
      )}

      {/* Footer Timestamp */}
      <p className="pb-2 text-center text-xs text-slate-400 font-semibold mt-8">
        {cacheAge ? `${dict.updated} ${cacheAge}` : `${dict.updated} ${timeAgo(data.generatedAt)}`}{' '}
        · Weather from Open-Meteo
      </p>
    </div>
  );
}

/**
 * Up to two initials for the avatar.
 *
 * Two words give one letter each ("Harsh Patel" → HP); a single word gives its
 * first two. Google accounts can arrive with no display name, so the email's
 * local part is the fallback before the generic placeholder — every farmer used
 * to see the literal "US" on the profile card regardless of who they were.
 */
function avatarInitials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.split('@')[0]?.trim();
  if (!source) return '👤';

  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0]?.slice(0, 2) ?? '');
  return letters.toUpperCase();
}

function getGreeting(dict: Record<string, string>, name: string): string {
  const hour = new Date().getHours();
  const greetingTemplate =
    hour < 12 ? dict.greetingMorning : hour < 17 ? dict.greetingAfternoon : dict.greetingEvening;
  return greetingTemplate.replace('{name}', name);
}
