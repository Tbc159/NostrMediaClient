/**
 * The Apple Podcasts categories, as data.
 *
 * This is the official list (podcasters.apple.com/support/1691): Apple
 * demands them in the feed, Amazon does too, and Spotify uses them to
 * classify. They live here, in the core, because both the 10154 form and the
 * feed check have to read the same list — and because a name typed by hand
 * with one comma too many is nobody's category.
 *
 * The strings are Apple's exact ones, `&` included: it is the feed generator
 * that has to write it `&amp;`, not us changing the name.
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

/** True when the pair exists in Apple's list, with a sub-category that belongs to that main one. */
export function isCategoriaApple(c: CategoriaPodcast): boolean {
  const sotto = CATEGORIE_APPLE[c.principale]
  if (!sotto) return false
  return c.sotto === undefined || c.sotto === '' || sotto.includes(c.sotto)
}

/** Apple accepts up to three categories; the first is the primary one. */
export const MAX_CATEGORIE = 3
