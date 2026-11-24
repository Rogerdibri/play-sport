export const mobileApiBase = (process.env.EXPO_PUBLIC_PLAYSPORT_API_BASE ?? 'http://localhost:4000/api').replace(/\/$/, '');
export const mobileScoringApiBase = `${mobileApiBase}/official-scoring`;
