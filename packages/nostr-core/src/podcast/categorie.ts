/**
 * Le categorie di Apple Podcasts, come dati.
 *
 * Sono l'elenco ufficiale (podcasters.apple.com/support/1691): Apple le
 * pretende nel feed, Amazon anche, e Spotify le usa per classificare. Stanno
 * qui, nel core, perche' sia il form del 10154 sia la verifica del feed devono
 * leggere la stessa lista — e perche' un nome scritto a mano con una virgola
 * di troppo non e' una categoria per nessuno.
 *
 * Le stringhe sono quelle esatte di Apple, `&` compresa: e' il generatore del
 * feed a doverla scrivere `&amp;`, non noi a cambiare il nome.
 */
export const CATEGORIE_APPLE: Readonly<Record<string, readonly string[]>> = {
  Arts: ['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts'],
  Business: ['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit'],
  Comedy: ['Comedy Interviews', 'Improv', 'Stand-Up'],
  Education: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'],
  Fiction: ['Comedy Fiction', 'Drama', 'Science Fiction'],
  Government: [],
  History: [],
  'Health & Fitness': [
    'Alternative Health',
    'Fitness',
    'Medicine',
    'Mental Health',
    'Nutrition',
    'Sexuality',
  ],
  'Kids & Family': ['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids'],
  Leisure: [
    'Animation & Manga',
    'Automotive',
    'Aviation',
    'Crafts',
    'Games',
    'Hobbies',
    'Home & Garden',
    'Video Games',
  ],
  Music: ['Music Commentary', 'Music History', 'Music Interviews'],
  News: [
    'Business News',
    'Daily News',
    'Entertainment News',
    'News Commentary',
    'Politics',
    'Sports News',
    'Tech News',
  ],
  'Religion & Spirituality': [
    'Buddhism',
    'Christianity',
    'Hinduism',
    'Islam',
    'Judaism',
    'Religion',
    'Spirituality',
  ],
  Science: [
    'Astronomy',
    'Chemistry',
    'Earth Sciences',
    'Life Sciences',
    'Mathematics',
    'Natural Sciences',
    'Nature',
    'Physics',
    'Social Sciences',
  ],
  'Society & Culture': [
    'Documentary',
    'Personal Journals',
    'Philosophy',
    'Places & Travel',
    'Relationships',
  ],
  Sports: [
    'Baseball',
    'Basketball',
    'Cricket',
    'Fantasy Sports',
    'Football',
    'Golf',
    'Hockey',
    'Rugby',
    'Running',
    'Soccer',
    'Swimming',
    'Tennis',
    'Volleyball',
    'Wilderness',
    'Wrestling',
  ],
  Technology: [],
  'True Crime': [],
  'TV & Film': ['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews'],
}

export interface CategoriaPodcast {
  principale: string
  sotto?: string
}

/** Vero se la coppia esiste nell'elenco Apple, con la sotto-categoria giusta per quella principale. */
export function isCategoriaApple(c: CategoriaPodcast): boolean {
  const sotto = CATEGORIE_APPLE[c.principale]
  if (!sotto) return false
  return c.sotto === undefined || c.sotto === '' || sotto.includes(c.sotto)
}

/** Apple accetta fino a tre categorie; la prima e' quella primaria. */
export const MAX_CATEGORIE = 3
