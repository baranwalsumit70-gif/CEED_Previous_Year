// Connection to the Supabase database of this website.
// These two values are meant to be public: the database only lets visitors use the exam
// functions, never read the tables directly (answer keys stay hidden until a student submits).
window.CEED_CONFIG = {
  SUPABASE_URL: 'https://nyxjaxlvrvyybgbeohbc.supabase.co',
  SUPABASE_KEY: 'sb_publishable_ad3077JOMhTmqMHzJA1_Lg_fL-QDcp_',
  SITE_NAME: 'CEED Mock Test',
};
