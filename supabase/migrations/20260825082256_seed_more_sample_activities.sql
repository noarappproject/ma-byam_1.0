-- 15 additional sample activities to stress-test search/filtering:
-- deliberate overlaps in category, topics, organization and neighborhood
-- across multiple rows, plus edge cases (null price, null age range,
-- status = full) already documented in the data model doc.

insert into public.activities (
  item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, recurrence_days, sessions_count,
  attendance_mode, location_name, neighborhood, age_min, age_max, gender, is_accessible,
  price, price_period, registration_required, registration_url, registration_deadline,
  capacity, spots_left, status, is_published, source_url, source_name
) values

-- tech (2 more, alongside the existing robotics club)
('activity', 'series', 'tech', array['תכנות', 'מחשבים'],
 'קורס תכנות פייתון לבני נוער',
 'לומדים לתכנת משחקים ואפליקציות בפייתון, משלב ראשוני ועד פרויקט אישי',
 'קורס בן 8 מפגשים שבועיים המלמד יסודות תכנות בפייתון, כולל בניית משחק פשוט ופרויקט גמר אישי. מתאים למתחילים לחלוטין.',
 'מתנ"ס בית הכרם', date '2026-09-03', date '2026-10-22', time '17:00', time '18:30', 'weekly', array[4], 8,
 'onsite', 'מתנ"ס בית הכרם', 'בית הכרם', 13, 17, 'mixed', true,
 200.00, 'total', true, 'https://example.org/register/python-course', null, 20, 5, 'open', true, null, 'מתנ"ס ירושלים'),

('activity', 'recurring', 'tech', array['בינה מלאכותית', 'רובוטיקה'],
 'חוג בינה מלאכותית ורובוטיקה מתקדם',
 'חוג מתקדם לנוער שכבר מכיר תכנות בסיסי, בונים פרויקטי AI ורובוטיקה',
 'המשך לחוג הרובוטיקה הבסיסי — עבודה עם חיישנים, למידת מכונה בסיסית ובניית פרויקט רובוטי עצמאי.',
 'מרכז המדע ירושלים', date '2026-09-02', null, time '18:00', time '19:30', 'weekly', array[2], null,
 'onsite', 'מרכז המדע ירושלים', 'גבעת רם', 15, 18, 'mixed', null,
 180.00, 'monthly', true, 'https://example.org/register/ai-robotics', null, null, null, 'open', true, null, null),

-- art (2 more, alongside the existing photography workshop)
('activity', 'one_time', 'art', array['אנימציה', 'עיצוב'],
 'סדנת אנימציה דיגיטלית',
 'סדנה חד יומית ליצירת סרטון אנימציה קצר משלב סקיצה ועד רינדור',
 'סדנה מעשית בת יום אחד ללימוד עקרונות אנימציה דיגיטלית ויצירת סרטון קצר באמצעות תוכנת אנימציה חינמית.',
 'בית הנוער אחת העם', date '2026-09-20', date '2026-09-20', time '10:00', time '15:00', 'none', null, 1,
 'onsite', 'בית הנוער אחת העם', 'קטמון', 12, 17, 'mixed', false,
 90.00, 'total', true, 'https://example.org/register/animation-workshop', '2026-09-18 23:59:00+03', 12, 3, 'open', true, null, null),

('activity', 'recurring', 'art', array['קרמיקה', 'עיצוב'],
 'חוג קרמיקה ועיצוב',
 'יוצרים כלים ותכשיטים מקרמיקה בסטודיו מאובזר',
 'חוג שבועי בו לומדים טכניקות יסוד בעבודה עם חרסית, כולל זיגוג וקדרות בגלגל.',
 'בית הנוער אחת העם', date '2026-09-08', null, time '16:30', time '18:00', 'weekly', array[1], null,
 'onsite', 'בית הנוער אחת העם', 'קטמון', 12, 18, 'girls', true,
 140.00, 'monthly', true, 'https://example.org/register/ceramics-club', null, null, null, 'open', true, null, null),

-- stage (2 more, alongside the existing concert event)
('event', 'one_time', 'stage', array['הופעות'],
 'פסטיבל תיאטרון נוער ירושלים',
 'שלושה ימי הצגות, סדנאות ומפגשי יוצרים לבני נוער אוהבי תיאטרון',
 'פסטיבל בן שלושה ימים עם הצגות מקור של קבוצות תיאטרון נוער, סדנאות משחק וכנס יוצרים. כניסה חופשית לכל האירועים.',
 'תיאטרון ירושלים', date '2026-09-24', date '2026-09-26', time '17:00', time '21:00', 'none', null, 1,
 'onsite', 'תיאטרון ירושלים', 'קרית שמואל', null, null, 'mixed', null,
 0.00, null, false, null, null, null, null, 'open', true, 'https://www.jerusalem-theatre.co.il/youth-festival', null),

('event', 'one_time', 'stage', array['הופעות'],
 'הצגת סטנד־אפ לנוער: צחוק זה בריאות',
 'מופע סטנד-אפ ייעודי לבני נוער עם קומיקאים מוכרים',
 'ערב סטנד-אפ קליל המיועד לגילאי תיכון, עם תוכן מותאם, כולל מפגש עם האומנים בסיום.',
 'היכל התרבות גבעת רם', date '2026-10-01', date '2026-10-01', time '20:30', time '22:00', 'none', null, 1,
 'onsite', 'היכל התרבות גבעת רם', 'גבעת רם', 13, null, 'mixed', null,
 45.00, 'total', true, 'https://example.org/register/standup-show', null, null, null, 'open', true, null, null),

-- sport (3, new category)
('activity', 'recurring', 'sport', array['כדורסל'],
 'חוג כדורסל לנערים',
 'אימוני כדורסל קבוצתיים לשיפור יכולת אישית ומשחק קבוצתי',
 'חוג המתאים לכל הרמות, מתמקד בטכניקה אישית, עבודת צוות ומשחקים מלאים בסוף כל אימון.',
 'מרכז הספורט העירוני', date '2026-09-06', null, time '18:00', time '19:30', 'weekly', array[0,3], null,
 'onsite', 'היכל הספורט גבעת שאול', 'גבעת שאול', 12, 17, 'boys', null,
 130.00, 'monthly', true, 'https://example.org/register/basketball-club', null, null, null, 'open', true, null, null),

('activity', 'series', 'sport', array['כדורגל'],
 'קייטנת כדורגל לחופש הגדול',
 'קייטנת יום בת חמישה ימים המשלבת אימוני כדורגל ומשחקים',
 'קייטנה בת חמישה ימים רצופים לחניכי כיתות ז׳-ט׳, עם אימוני כדורגל מקצועיים ופעילויות גיבוש.',
 'מרכז הספורט העירוני', date '2026-08-30', date '2026-09-03', time '08:00', time '13:00', 'daily', null, 5,
 'onsite', 'מגרש הכדורגל העירוני', 'רמות', 12, 15, 'boys', null,
 450.00, 'total', true, 'https://example.org/register/football-camp', null, 30, 0, 'full', true, null, null),

('activity', 'recurring', 'sport', array['שחייה'],
 'חוג שחייה לנוער',
 'שיפור טכניקת שחייה וכושר גופני בבריכה מקורה',
 'אימוני שחייה שבועיים בבריכה מחוממת, בהתאם לרמת השחיין, עם מדריכים מוסמכים.',
 'בריכת השחייה העירונית', date '2026-09-07', null, time '17:00', time '18:00', 'weekly', array[1,4], null,
 'onsite', 'בריכת גני מאיר', 'רחביה', 10, 18, 'mixed', true,
 220.00, 'monthly', true, 'https://example.org/register/swimming-club', null, null, null, 'open', true, null, null),

-- music (2, new category)
('activity', 'recurring', 'music', array['גיטרה'],
 'חוג גיטרה למתחילים',
 'לומדים לנגן גיטרה מהבסיס, כולל תיאוריה ונגינה בקבוצה',
 'חוג שבועי המתאים למתחילים ללא כל ידע מוקדם, מסתיים במופע קטן לכל המשפחה בסוף השנה.',
 'קונסרבטוריון ירושלים', date '2026-09-09', null, time '16:00', time '17:00', 'weekly', array[2], null,
 'onsite', 'קונסרבטוריון ירושלים', 'רחביה', 10, 16, 'mixed', null,
 160.00, 'monthly', true, 'https://example.org/register/guitar-club', null, null, null, 'open', true, null, null),

('activity', 'one_time', 'music', array['הפקה מוזיקלית', 'די־ג׳יי'],
 'סדנת הפקה מוזיקלית ודי־ג׳יי',
 'סדנה חד־יומית ליצירת טראק מוזיקלי ולימוד בסיסי הדי-ג׳יינג',
 'סדנה מעשית עם ציוד הפקה מקצועי, ילמדו הבסיס של תכנות ביטים, מיקס ושילוב סאונד לייב.',
 'סטודיו סאונדסקייפ', date '2026-09-27', date '2026-09-27', time '13:00', time '17:00', 'none', null, 1,
 'onsite', 'סטודיו סאונדסקייפ', 'תלפיות', 14, 18, 'mixed', null,
 220.00, 'total', true, 'https://example.org/register/music-production', null, 10, 2, 'open', true, null, null),

-- nature (1, new category)
('event', 'one_time', 'nature', array['טבע', 'אקולוגיה'],
 'טיול טבע וסיור אקולוגי בעמק הצבאים',
 'סיור מודרך בעמק הצבאים עם התמקדות באקולוגיה עירונית',
 'טיול יום המשלב הליכה קלה עם הסברים על המערכת האקולוגית המיוחדת של עמק הצבאים בירושלים.',
 'החברה להגנת הטבע', date '2026-10-03', date '2026-10-03', time '09:00', time '12:00', 'none', null, 1,
 'onsite', 'עמק הצבאים', 'גבעת מרדכי', null, null, 'mixed', null,
 0.00, null, true, 'https://example.org/register/nature-tour', null, null, null, 'open', true, null, null),

-- leadership (1, new category) — deliberately no price published
('activity', 'recurring', 'leadership', array['מנהיגות', 'דיבייט'],
 'חוג מנהיגות ודיבייט',
 'מפתחים כישורי נאום, חשיבה ביקורתית ועבודת צוות',
 'חוג שבועי לתלמידי תיכון המתעניינים בהנהגה ציבורית, כולל תרגול דיבייטים ותחרויות בין קבוצתיות.',
 'עיריית ירושלים - אגף נוער', date '2026-09-10', null, time '17:30', time '19:00', 'weekly', array[3], null,
 'onsite', 'בית הנוער אחת העם', 'קטמון', 15, 18, 'mixed', null,
 null, null, true, 'https://example.org/register/leadership-club', null, null, null, 'open', true, null, null),

-- volunteer (1, new category)
('activity', 'recurring', 'volunteer', array['חונכות', 'עזרה לזולת'],
 'תוכנית חונכות והתנדבות קהילתית',
 'מתנדבים כחונכים לילדים מהשכונה בעזרה בשיעורי בית ובפעילויות פנאי',
 'תוכנית התנדבות שבועית בה נערי תיכון מלווים ילדים מבתי ספר יסודיים בשכונה, בעזרה לימודית ובפעילויות משותפות.',
 'עמותת רוח טובה', date '2026-09-14', null, time '16:00', time '17:30', 'weekly', array[0], null,
 'onsite', 'מרכז קהילתי בית הכרם', 'בית הכרם', 15, 18, 'mixed', null,
 0.00, null, true, 'https://example.org/register/mentoring-program', null, null, null, 'open', true, null, null),

-- gaming (1, new category)
('event', 'one_time', 'gaming', array['גיימינג תחרותי'],
 'טורניר גיימינג לנוער',
 'תחרות גיימינג קבוצתית עם פרסים לזוכים',
 'טורניר חד־יומי במשחקי מחשב פופולריים, בהרכבי קבוצות, עם ציוד גיימינג מקצועי במקום.',
 'מרכז המחשבים הקהילתי', date '2026-09-19', date '2026-09-19', time '14:00', time '19:00', 'none', null, 1,
 'onsite', 'מרכז המחשבים הקהילתי', 'רמות', 12, 18, 'mixed', null,
 20.00, 'total', true, 'https://example.org/register/gaming-tournament', null, 40, 40, 'open', true, null, null);
