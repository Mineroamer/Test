/*
 * Connections boards.
 *
 * Whole puzzles, not a pool of categories to shuffle together.
 *
 * That distinction is the entire game. The four categories in a real
 * Connections are chosen *with each other* so that their words overlap: a
 * board of wrestling roles, fish, words meaning principal and hidden tennis
 * terms works because HEEL and SOLE look like parts of a shoe, MULLET looks
 * like a haircut, and ARCH looks like a foot. Five or six words seem to fit
 * one theme, and that theme is the trap.
 *
 * Dealing four unrelated categories cannot produce that, however good each
 * category is on its own - every word simply announces where it belongs, and
 * the puzzle becomes sorting rather than solving. So these are written as
 * finished boards, one at a time, the way the real ones are.
 *
 * Each carries a `trap` note saying what the misdirection is. Nothing reads it
 * at runtime; it is there so that a board can be checked against its own
 * intention later, and so that anyone adding one knows what the job is.
 *
 * Levels run 0 to 3 - yellow, green, blue, purple. Purple is wordplay: hidden
 * words, homophones, a shared prefix. It is the one that should only make
 * sense afterwards.
 */

module.exports = [
  {
    trap: "RYE and SCOTCH read as bread and tape; MALT reads as a drink you order.",
    groups: [
      { level: 0, clue: "Breads", words: ["NAAN", "PITA", "BAGEL", "CHALLAH"] },
      { level: 1, clue: "Whiskies", words: ["RYE", "BOURBON", "SCOTCH", "MALT"] },
      { level: 2, clue: "___ TAPE", words: ["DUCT", "MASKING", "RED", "TICKER"] },
      { level: 3, clue: "___ SHOT", words: ["MUG", "LONG", "SNAP", "BUCK"] },
    ],
  },
  {
    trap: "PALM, NAIL and RING all look like parts of a hand.",
    groups: [
      { level: 0, clue: "Trees", words: ["PALM", "BEECH", "ASPEN", "LARCH"] },
      { level: 1, clue: "Things a carpenter uses", words: ["NAIL", "PLANE", "LEVEL", "CLAMP"] },
      { level: 2, clue: "Boxing sounds", words: ["BELL", "RING", "COUNT", "CORNER"] },
      { level: 3, clue: "Hidden body parts", words: ["SHINGLE", "BEARABLE", "CHEEKY", "HIPPO"] },
    ],
  },
  {
    trap: "DIAMOND and CLUB look like card suits; BAT and BASE look like baseball.",
    groups: [
      { level: 0, clue: "Baseball things", words: ["MITT", "PITCHER", "DUGOUT", "INNING"] },
      { level: 1, clue: "Places to go dancing", words: ["CLUB", "BALL", "DISCO", "SOCIAL"] },
      { level: 2, clue: "Shapes on a road sign", words: ["DIAMOND", "OCTAGON", "CHEVRON", "TRIANGLE"] },
      { level: 3, clue: "Animals that are also verbs", words: ["BAT", "BADGER", "HOUND", "CROW"] },
    ],
  },
  {
    trap: "PUPIL, IRIS and LASH look like parts of an eye - only one group is.",
    groups: [
      { level: 0, clue: "Flowers", words: ["IRIS", "PEONY", "DAHLIA", "STOCK"] },
      { level: 1, clue: "People at a school", words: ["PUPIL", "HEAD", "PORTER", "MATRON"] },
      { level: 2, clue: "Strike hard", words: ["LASH", "BELT", "THRASH", "WHACK"] },
      { level: 3, clue: "Contain somewhere to live", words: ["VILLAGERS", "MANORIAL", "LODGINGS", "HUTCHES"] },
    ],
  },
  {
    trap: "SOLE and HEEL both look like parts of a shoe. Neither is.",
    groups: [
      { level: 0, clue: "Flat fish", words: ["SOLE", "PLAICE", "TURBOT", "DAB"] },
      { level: 1, clue: "Unpleasant person", words: ["HEEL", "CAD", "ROTTER", "SWINE"] },
      { level: 2, clue: "Parts of a shoe", words: ["LACE", "EYELET", "INSTEP", "WELT"] },
      { level: 3, clue: "Homophones of letters", words: ["QUEUE", "ARE", "WHY", "SEA"] },
    ],
  },
  {
    trap: "MINT, PRESS and MILL all suggest making money.",
    groups: [
      { level: 0, clue: "Herbs", words: ["MINT", "DILL", "CHIVE", "SORREL"] },
      { level: 1, clue: "Journalism as a whole", words: ["PRESS", "MEDIA", "PAPERS", "TABLOIDS"] },
      { level: 2, clue: "Places that grind", words: ["MILL", "QUERN", "PESTLE", "GRINDER"] },
      { level: 3, clue: "Words before HOUSE", words: ["GREEN", "LIGHT", "WARE", "FARM"] },
    ],
  },
  {
    trap: "SPRING, FALL and SEASON all point at the calendar.",
    groups: [
      { level: 0, clue: "Sources of water", words: ["SPRING", "WELL", "BROOK", "AQUIFER"] },
      { level: 1, clue: "Trip and tumble", words: ["FALL", "STUMBLE", "TOPPLE", "SPRAWL"] },
      { level: 2, clue: "Add flavour to", words: ["SEASON", "SPICE", "DRESS", "PEPPER"] },
      { level: 3, clue: "Contain a month", words: ["MAYONNAISE", "MARCHED", "AUGUSTUS", "DECEMBRIST"] },
    ],
  },
  {
    trap: "BANK, CURRENT and DRAFT all read as banking.",
    groups: [
      { level: 0, clue: "Beside a river", words: ["BANK", "LEVEE", "TOWPATH", "REEDBED"] },
      { level: 1, clue: "Moving water", words: ["CURRENT", "EDDY", "RIPTIDE", "UNDERTOW"] },
      { level: 2, clue: "A cold breeze indoors", words: ["DRAFT", "CHILL", "GUST", "NIP"] },
      { level: 3, clue: "Contain a hidden coin", words: ["QUARTERLY", "DIMENSION", "PENNILESS", "CENTAUR"] },
    ],
  },
  {
    trap: "CRANE, SWALLOW and SWIFT all look like birds - two of them are not.",
    groups: [
      { level: 0, clue: "Birds", words: ["SWIFT", "PLOVER", "GANNET", "SHRIKE"] },
      { level: 1, clue: "Lifting machines", words: ["CRANE", "HOIST", "WINCH", "JACK"] },
      { level: 2, clue: "Get it all in at once", words: ["SWALLOW", "DOWN", "NECK", "GULP"] },
      { level: 3, clue: "Rhyme with FLIGHT", words: ["SLEIGHT", "CITE", "BYTE", "HEIGHT"] },
    ],
  },
  {
    trap: "SCALE, KEY and NOTE all read as music.",
    groups: [
      { level: 0, clue: "On a map", words: ["SCALE", "LEGEND", "CONTOUR", "COMPASS"] },
      { level: 1, clue: "Small island", words: ["KEY", "CAY", "ISLET", "ATOLL"] },
      { level: 2, clue: "Take notice of", words: ["NOTE", "MARK", "HEED", "REGARD"] },
      { level: 3, clue: "Hidden musical instruments", words: ["DRUMSTICK", "HARPOON", "VIOLATE", "ORGANIC"] },
    ],
  },
  {
    trap: "CHIPS, ROLL and CHOP all look like food.",
    groups: [
      { level: 0, clue: "In a casino", words: ["CHIPS", "DEALER", "CROUPIER", "SHOE"] },
      { level: 1, clue: "What a ship does at sea", words: ["ROLL", "PITCH", "YAW", "LIST"] },
      { level: 2, clue: "Cut down", words: ["CHOP", "FELL", "HEW", "LOP"] },
      { level: 3, clue: "Anagrams of animals", words: ["TOGA", "LOIN", "BARE", "SHORE"] },
    ],
  },
  {
    trap: "PITCH, COURT and MATCH all look like sport.",
    groups: [
      { level: 0, clue: "Try to win a heart", words: ["COURT", "WOO", "PURSUE", "ROMANCE"] },
      { level: 1, clue: "Strike a light", words: ["MATCH", "TAPER", "SPILL", "TINDER"] },
      { level: 2, clue: "Tar-like", words: ["PITCH", "BITUMEN", "ASPHALT", "RESIN"] },
      { level: 3, clue: "Contain a hidden sport", words: ["SURFACE", "SKIRMISH", "BOXWOOD", "POLONIUM"] },
    ],
  },
  {
    trap: "TRUNK, BOOT and BONNET all read as parts of a car.",
    groups: [
      { level: 0, clue: "Parts of an elephant", words: ["TRUNK", "TUSK", "IVORY", "HOWDAH"] },
      { level: 1, clue: "Footwear", words: ["BOOT", "BROGUE", "SANDAL", "GALOSH"] },
      { level: 2, clue: "Old-fashioned hats", words: ["BONNET", "CLOCHE", "TOPPER", "TRICORN"] },
      { level: 3, clue: "Contain a hidden car", words: ["MINIATURE", "FORDING", "SEATED", "AUDIENCE"] },
    ],
  },
  {
    trap: "LEAD, PLUMB and IRON all read as metals.",
    groups: [
      { level: 0, clue: "Go first", words: ["LEAD", "HEAD", "PIONEER", "SPEARHEAD"] },
      { level: 1, clue: "Get the creases out", words: ["IRON", "PRESS", "STEAM", "SMOOTH"] },
      { level: 2, clue: "Work out the depth of", words: ["PLUMB", "SOUND", "FATHOM", "GAUGE"] },
      { level: 3, clue: "Contain a hidden metal", words: ["STINK", "BRASSIERE", "IRONIC", "LEADER"] },
    ],
  },
  {
    trap: "STAR, RING and MOON all suggest the night sky.",
    groups: [
      { level: 0, clue: "In a circus", words: ["RING", "TRAPEZE", "BIGTOP", "CLOWN"] },
      { level: 1, clue: "Give top billing to", words: ["STAR", "HEADLINE", "FEATURE", "TOPLINE"] },
      { level: 2, clue: "Laze about", words: ["MOON", "LOAF", "IDLE", "DAWDLE"] },
      { level: 3, clue: "Words before LIGHT", words: ["SPOT", "FLASH", "DAY", "HIGH"] },
    ],
  },
  {
    trap: "BILL, DUCK and BOB read as a name, a bird and a name again.",
    groups: [
      { level: 0, clue: "Money owed", words: ["BILL", "TAB", "INVOICE", "CHECK"] },
      { level: 1, clue: "Get out of the way fast", words: ["DUCK", "DIVE", "SWERVE", "DODGE"] },
      { level: 2, clue: "Move up and down", words: ["BOB", "BOUNCE", "JIG", "TEETER"] },
      { level: 3, clue: "Hidden birds", words: ["STERNUM", "GULLIBLE", "CROWDED", "HAWKISH"] },
    ],
  },
  {
    trap: "BASS, TENOR and PITCH all read as singing.",
    groups: [
      { level: 0, clue: "Freshwater fish", words: ["BASS", "PERCH", "ROACH", "CHUB"] },
      { level: 1, clue: "General drift of a speech", words: ["TENOR", "GIST", "THRUST", "SUBSTANCE"] },
      { level: 2, clue: "A sales approach", words: ["PITCH", "SPIEL", "PATTER", "LINE"] },
      { level: 3, clue: "Contain a hidden note", words: ["FAMILY", "SOLID", "LATTICE", "REDOING"] },
    ],
  },
  {
    trap: "ROCK, WAVE and BREAK all read as the seaside.",
    groups: [
      { level: 0, clue: "Genres of music", words: ["ROCK", "SKA", "GRIME", "TRANCE"] },
      { level: 1, clue: "Signal with a hand", words: ["WAVE", "BECKON", "SALUTE", "HAIL"] },
      { level: 2, clue: "A pause from work", words: ["BREAK", "RECESS", "BREATHER", "INTERVAL"] },
      { level: 3, clue: "Contain a hidden sea", words: ["BALTICS", "REDACT", "CORALS", "DEADPAN"] },
    ],
  },
  {
    trap: "SHARP, FLAT and NATURAL all read as musical notation.",
    groups: [
      { level: 0, clue: "A place to live", words: ["FLAT", "BEDSIT", "DIGS", "LODGINGS"] },
      { level: 1, clue: "Clever in a cutting way", words: ["SHARP", "ACERBIC", "BITING", "TART"] },
      { level: 2, clue: "Someone with a gift for it", words: ["NATURAL", "PRODIGY", "TALENT", "MARVEL"] },
      { level: 3, clue: "Words before MINDED", words: ["ABSENT", "LIKE", "SINGLE", "OPEN"] },
    ],
  },
  {
    trap: "LIGHT, FAIR and BRIGHT all describe weather - and none of them do here.",
    groups: [
      { level: 0, clue: "A village celebration", words: ["FAIR", "CARNIVAL", "GALA", "FETE"] },
      { level: 1, clue: "Not heavy", words: ["LIGHT", "AIRY", "SLIGHT", "FEATHERY"] },
      { level: 2, clue: "Quick to learn", words: ["BRIGHT", "ASTUTE", "KEEN", "SHREWD"] },
      { level: 3, clue: "Contain a hidden weather word", words: ["SNOWMAN", "FOGGIEST", "HAILSTORM", "MISTAKEN"] },
    ],
  },
  {
    trap: "CAPITAL, LETTER and CHARACTER all point at the alphabet.",
    groups: [
      { level: 0, clue: "Money to invest", words: ["CAPITAL", "FUNDS", "STAKE", "PRINCIPAL"] },
      { level: 1, clue: "Post that arrives", words: ["LETTER", "PARCEL", "POSTCARD", "TELEGRAM"] },
      { level: 2, clue: "A person in a play", words: ["CHARACTER", "ROLE", "PART", "LEAD"] },
      { level: 3, clue: "Hidden Greek letters", words: ["CHIMNEY", "PHIAL", "PSIONIC", "METAPHOR"] },
    ],
  },
  {
    trap: "CHAIR, TABLE and BOARD all read as furniture.",
    groups: [
      { level: 0, clue: "Preside over", words: ["CHAIR", "HEAD", "OVERSEE", "CONVENE"] },
      { level: 1, clue: "Put off until later", words: ["TABLE", "SHELVE", "DEFER", "POSTPONE"] },
      { level: 2, clue: "Step onto a train or plane", words: ["BOARD", "EMBARK", "ENTRAIN", "EMPLANE"] },
      { level: 3, clue: "Words before ROOM", words: ["BATH", "MUSH", "LEG", "CLASS"] },
    ],
  },
  {
    trap: "MOLE, SPOT and PATCH all read as marks on skin.",
    groups: [
      { level: 0, clue: "Burrowing animals", words: ["MOLE", "BADGER", "GOPHER", "VOLE"] },
      { level: 1, clue: "Notice something", words: ["SPOT", "SIGHT", "DESCRY", "CLOCK"] },
      { level: 2, clue: "Mend roughly", words: ["PATCH", "COBBLE", "BODGE", "DARN"] },
      { level: 3, clue: "Contain a hidden dog", words: ["PUGILIST", "COLLIERY", "CHOWDER", "BOXERS"] },
    ],
  },
  {
    trap: "STORY, PLOT and PLAN all read as writing a novel.",
    groups: [
      { level: 0, clue: "A floor of a building", words: ["STORY", "LEVEL", "DECK", "TIER"] },
      { level: 1, clue: "A patch of ground", words: ["PLOT", "ALLOTMENT", "PARCEL", "LOT"] },
      { level: 2, clue: "A drawing of a building", words: ["PLAN", "ELEVATION", "BLUEPRINT", "SECTION"] },
      { level: 3, clue: "Contain a hidden number", words: ["OFTEN", "CANINE", "HONEST", "SEVERANCE"] },
    ],
  },
  {
    trap: "SPELL, CHARM and CAST all read as magic.",
    groups: [
      { level: 0, clue: "A period of weather", words: ["SPELL", "SNAP", "PATCH", "STRETCH"] },
      { level: 1, clue: "On a bracelet", words: ["CHARM", "BEAD", "LOCKET", "PENDANT"] },
      { level: 2, clue: "The actors in a play", words: ["CAST", "COMPANY", "TROUPE", "ENSEMBLE"] },
      { level: 3, clue: "Words after BROOM", words: ["STICK", "CUPBOARD", "HANDLE", "CLOSET"] },
    ],
  },
  {
    trap: "COACH, TRAIN and DRILL all read as sport.",
    groups: [
      { level: 0, clue: "Ways to travel by road", words: ["COACH", "TRAM", "SHUTTLE", "MINIBUS"] },
      { level: 1, clue: "A wedding dress has one", words: ["TRAIN", "VEIL", "BODICE", "SASH"] },
      { level: 2, clue: "Make a hole", words: ["DRILL", "BORE", "PIERCE", "AUGER"] },
      { level: 3, clue: "Contain a hidden vehicle", words: ["SCARLET", "BUSTED", "VANILLA", "TRUCKLE"] },
    ],
  },
  {
    trap: "PORT, STARBOARD and BOW read as sailing - only one group is.",
    groups: [
      { level: 0, clue: "Fortified wines", words: ["PORT", "SHERRY", "MADEIRA", "MARSALA"] },
      { level: 1, clue: "Bend at the waist", words: ["BOW", "STOOP", "DUCK", "INCLINE"] },
      { level: 2, clue: "Parts of a ship", words: ["STARBOARD", "GALLEY", "KEEL", "TRANSOM"] },
      { level: 3, clue: "Homophones of numbers", words: ["WON", "TOO", "ATE", "FOR"] },
    ],
  },
  {
    trap: "TIP, POINT and END all mean the same thing - but only one group means it.",
    groups: [
      { level: 0, clue: "Something extra for the waiter", words: ["TIP", "GRATUITY", "SERVICE", "BAKSHEESH"] },
      { level: 1, clue: "The sharp end", words: ["POINT", "NIB", "PRONG", "SPIKE"] },
      { level: 2, clue: "Bring to a close", words: ["END", "CONCLUDE", "WRAP", "TERMINATE"] },
      { level: 3, clue: "Words before OFF", words: ["KICK", "TAKE", "RIP", "LAY"] },
    ],
  },
  {
    trap: "SHEET, BLANKET and COVER read as bedding.",
    groups: [
      { level: 0, clue: "On a boat", words: ["SHEET", "HALYARD", "PAINTER", "CLEAT"] },
      { level: 1, clue: "Total and sweeping", words: ["BLANKET", "WHOLESALE", "GENERAL", "OUTRIGHT"] },
      { level: 2, clue: "Stand in for someone", words: ["COVER", "DEPUTISE", "SUB", "RELIEVE"] },
      { level: 3, clue: "Words after BED", words: ["SPREAD", "ROCK", "SIDE", "TIME"] },
    ],
  },
  {
    trap: "PRESENT, GIFT and BOX all read as birthdays.",
    groups: [
      { level: 0, clue: "Here, not absent", words: ["PRESENT", "ATTENDING", "AROUND", "THERE"] },
      { level: 1, clue: "A natural talent", words: ["GIFT", "FLAIR", "KNACK", "APTITUDE"] },
      { level: 2, clue: "Fight with fists", words: ["BOX", "SPAR", "GRAPPLE", "SCRAP"] },
      { level: 3, clue: "Words after CHRISTMAS", words: ["CARD", "CRACKER", "PUDDING", "EVE"] },
    ],
  },
  {
    trap: "ORDER, SUIT and CASE all read as a courtroom.",
    groups: [
      { level: 0, clue: "Being organised", words: ["ORDER", "NEATNESS", "TIDINESS", "METHOD"] },
      { level: 1, clue: "Be right for", words: ["SUIT", "BEFIT", "BECOME", "FLATTER"] },
      { level: 2, clue: "Luggage", words: ["CASE", "TRUNK", "HOLDALL", "VALISE"] },
      { level: 3, clue: "Words before WORK", words: ["HOME", "NET", "PATCH", "CLOCK"] },
    ],
  },
  {
    trap: "STICK, BAT and CLUB read as things you hit with.",
    groups: [
      { level: 0, clue: "Hold fast", words: ["STICK", "CLING", "ADHERE", "BOND"] },
      { level: 1, clue: "Flying mammals", words: ["BAT", "PIPISTRELLE", "SEROTINE", "NOCTULE"] },
      { level: 2, clue: "A society you join", words: ["CLUB", "GUILD", "LODGE", "UNION"] },
      { level: 3, clue: "Contain a hidden tool", words: ["SAWDUST", "VICEROY", "PROFILE", "PLANET"] },
    ],
  },
  {
    trap: "TRIP, JOURNEY and PASSAGE all read as travel.",
    groups: [
      { level: 0, clue: "Lose your footing", words: ["TRIP", "STUMBLE", "FALTER", "LURCH"] },
      { level: 1, clue: "A stretch of writing", words: ["PASSAGE", "EXTRACT", "EXCERPT", "SNIPPET"] },
      { level: 2, clue: "A long slow process", words: ["JOURNEY", "ODYSSEY", "SLOG", "HAUL"] },
      { level: 3, clue: "Words before WAY", words: ["HALF", "GATE", "DRIVE", "HIGH"] },
    ],
  },
  {
    trap: "CATCH, HOOK and NET all read as fishing.",
    groups: [
      { level: 0, clue: "The hidden condition", words: ["CATCH", "SNAG", "DRAWBACK", "PROVISO"] },
      { level: 1, clue: "Memorable bit of a song", words: ["HOOK", "RIFF", "CHORUS", "REFRAIN"] },
      { level: 2, clue: "What you actually keep", words: ["NET", "CLEAR", "DISPOSABLE", "SPENDABLE"] },
      { level: 3, clue: "Contain a hidden fish", words: ["SKATEBOARD", "BRAYS", "CARPENTER", "SOLEMN"] },
    ],
  },
  {
    trap: "GRAVE, PLOT and MOURNING all read as a funeral.",
    groups: [
      { level: 0, clue: "Very serious", words: ["GRAVE", "SOLEMN", "WEIGHTY", "SOBER"] },
      { level: 1, clue: "Cook something up in secret", words: ["PLOT", "CONSPIRE", "SCHEME", "CONNIVE"] },
      { level: 2, clue: "Early in the day", words: ["MORNING", "DAWN", "SUNUP", "DAYBREAK"] },
      { level: 3, clue: "Contain a hidden colour", words: ["BOREDOM", "TANGENT", "PLUMBER", "JADED"] },
    ],
  },
  {
    trap: "CROWN, CAP and FILLING all read as dentistry.",
    groups: [
      { level: 0, clue: "Worn on the head", words: ["CAP", "BERET", "FEZ", "TURBAN"] },
      { level: 1, clue: "The top of a hill", words: ["CROWN", "BROW", "SUMMIT", "CREST"] },
      { level: 2, clue: "Inside a sandwich", words: ["FILLING", "SPREAD", "RELISH", "GARNISH"] },
      { level: 3, clue: "Words after GOLD", words: ["FISH", "SMITH", "RUSH", "FINCH"] },
    ],
  },
];
