const MONTHLY_BUDGET = 8500;

const EXPENSE_CATS = [
  'Food & drinks','Uber/Taxi','Transport','Socializing','Concert','Movie',
  'Entertainment','CD/Vinyl','Beauty & health','Phone & subscriptions',
  'Books & education','Gifts & treats','Travel','Shopping','Leisure',
  'Utilities','Fees','Family','Misc',
];
const INCOME_CATS = [
  'Shooting','Video editing','Graphic design','Writing/Caption','Freelance day rate',
  'Project fee','Retainer','Sales/Resale','Event','Laisee','Other income',
];

// Short code → full category name
const CAT_MAP = {
  c_food: 'Food & drinks', c_uber: 'Uber/Taxi', c_trans: 'Transport', c_social: 'Socializing',
  c_concert: 'Concert', c_movie: 'Movie', c_ent: 'Entertainment', c_cd: 'CD/Vinyl',
  c_health: 'Beauty & health', c_phone: 'Phone & subscriptions',
  c_edu: 'Books & education', c_gifts: 'Gifts & treats', c_travel: 'Travel',
  c_shop: 'Shopping', c_leisure: 'Leisure',
  c_util: 'Utilities', c_fees: 'Fees', c_family: 'Family', c_misc: 'Misc',
  c_shoot: 'Shooting', c_video: 'Video editing', c_design: 'Graphic design',
  c_copy: 'Writing/Caption', c_rate: 'Freelance day rate', c_proj: 'Project fee',
  c_ret: 'Retainer', c_resale: 'Sales/Resale', c_event: 'Event',
  c_lai: 'Laisee', c_otherinc: 'Other income',
};

const EXPENSE_CAT_BTNS = [
  ['🍜 Food', 'c_food'], ['🚕 Uber/Taxi', 'c_uber'],
  ['🚇 Transport', 'c_trans'], ['🍻 Socializing', 'c_social'],
  ['🎤 Concert', 'c_concert'], ['🎬 Movie', 'c_movie'],
  ['🎮 Entertainment', 'c_ent'], ['💿 CD/Vinyl', 'c_cd'],
  ['💄 Beauty & health', 'c_health'], ['📱 Phone & subs', 'c_phone'],
  ['📚 Education', 'c_edu'], ['🎁 Gifts & treats', 'c_gifts'],
  ['✈️ Travel', 'c_travel'], ['🛍 Shopping', 'c_shop'],
  ['🏋️ Leisure', 'c_leisure'],
  ['🔧 Utilities', 'c_util'], ['💸 Fees', 'c_fees'],
  ['👨‍👩‍👧 Family', 'c_family'], ['📦 Misc', 'c_misc'],
];
const INCOME_CAT_BTNS = [
  ['📷 Shooting', 'c_shoot'], ['🎞 Video editing', 'c_video'],
  ['🎨 Graphic design', 'c_design'], ['✍️ Writing/Caption', 'c_copy'],
  ['📆 Day rate', 'c_rate'], ['💼 Project fee', 'c_proj'],
  ['🔁 Retainer', 'c_ret'], ['🏷 Sales/Resale', 'c_resale'],
  ['🎪 Event', 'c_event'], ['🧧 Laisee', 'c_lai'],
  ['💰 Other income', 'c_otherinc'],
];

module.exports = {
  MONTHLY_BUDGET,
  EXPENSE_CATS,
  INCOME_CATS,
  CAT_MAP,
  EXPENSE_CAT_BTNS,
  INCOME_CAT_BTNS,
};
