/*
 * Strands themes.
 *
 * A board is six squares across and eight down, so the words chosen for one
 * puzzle must use exactly forty-eight letters between them - no more, none
 * left over. That is why each theme carries far more words than a puzzle
 * needs: the dealer picks whichever subset adds up, and a thin pool would
 * often have no subset that does.
 *
 * The spangram is the word that names the theme and has to reach from one side
 * of the board to the other. It is always used.
 *
 * Written by hand, like the Connections categories, because "what do these
 * have in common" is a judgement rather than something a word list knows.
 */

module.exports = [
  {
    theme: "Making a splash",
    spangram: "SWIMMING",
    words: ["FREESTYLE", "BUTTERFLY", "BACKSTROKE", "MEDLEY", "CRAWL", "FLOAT",
            "DIVE", "LANE", "POOL", "KICK", "TREAD", "GOGGLES", "SPLASH"],
  },
  {
    theme: "In the kitchen",
    spangram: "COOKING",
    words: ["SIMMER", "WHISK", "KNEAD", "BRAISE", "POACH", "ROAST", "SAUTE",
            "BAKE", "BOIL", "GRILL", "STEAM", "CHOP", "DICE", "SEAR", "BASTE"],
  },
  {
    theme: "Weather report",
    spangram: "FORECAST",
    words: ["THUNDER", "DRIZZLE", "BLIZZARD", "MONSOON", "SHOWER", "BREEZE",
            "CLOUD", "FROST", "HAIL", "MIST", "GALE", "SLEET", "SNOW", "SQUALL"],
  },
  {
    theme: "Out past Mars",
    spangram: "PLANETS",
    words: ["MERCURY", "VENUS", "JUPITER", "SATURN", "NEPTUNE", "URANUS",
            "EARTH", "PLUTO", "COMET", "ORBIT", "MOON", "RING", "CRATER"],
  },
  {
    theme: "Strike up the band",
    spangram: "ORCHESTRA",
    words: ["VIOLIN", "CELLO", "VIOLA", "HARP", "BASS", "BANJO", "GUITAR",
            "FIDDLE", "LUTE", "SITAR", "UKULELE", "OBOE", "FLUTE", "DRUM"],
  },
  {
    theme: "Something feline",
    spangram: "WILDCATS",
    words: ["LION", "TIGER", "JAGUAR", "LEOPARD", "CHEETAH", "COUGAR", "LYNX",
            "PUMA", "OCELOT", "CARACAL", "PANTHER", "SERVAL", "MARGAY"],
  },
  {
    theme: "Your turn",
    spangram: "TABLETOP",
    words: ["CHESS", "CHECKERS", "DOMINOES", "SCRABBLE", "MONOPOLY", "CLUEDO",
            "RISK", "LUDO", "MAHJONG", "DRAUGHTS", "DICE", "COUNTER", "BOARD"],
  },
  {
    theme: "Order at the counter",
    spangram: "BARISTA",
    words: ["LATTE", "MOCHA", "ESPRESSO", "AMERICANO", "MACCHIATO", "CORTADO",
            "RISTRETTO", "AFFOGATO", "DECAF", "FILTER", "CREMA", "BEANS"],
  },
  {
    theme: "Down where it is dark",
    spangram: "SEABED",
    words: ["CORAL", "URCHIN", "OCTOPUS", "DOLPHIN", "STINGRAY", "PLANKTON",
            "SEAWEED", "MUSSEL", "SHRIMP", "WHALE", "SHARK", "KELP", "REEF"],
  },
  {
    theme: "Up where the air is thin",
    spangram: "SUMMITS",
    words: ["ANDES", "ALPS", "ROCKIES", "URALS", "ATLAS", "HIMALAYAS",
            "PYRENEES", "CASCADES", "SIERRA", "RIDGE", "SLOPE", "PEAK", "SCREE"],
  },
  {
    theme: "Twirl it round a fork",
    spangram: "NOODLES",
    words: ["PENNE", "FUSILLI", "RIGATONI", "ORZO", "FARFALLE", "LINGUINE",
            "RAVIOLI", "MACARONI", "LASAGNE", "GNOCCHI", "SPAGHETTI", "PESTO"],
  },
  {
    theme: "Deal me in",
    spangram: "SHUFFLE",
    words: ["POKER", "BRIDGE", "RUMMY", "SOLITAIRE", "CANASTA", "CRIBBAGE",
            "BLACKJACK", "WHIST", "EUCHRE", "PATIENCE", "SNAP", "TRUMP", "DEAL"],
  },
  {
    theme: "Among the trees",
    spangram: "WOODLAND",
    words: ["MAPLE", "BIRCH", "WILLOW", "CEDAR", "POPLAR", "ASPEN", "SPRUCE",
            "CHESTNUT", "SYCAMORE", "JUNIPER", "HAWTHORN", "ALDER", "ROWAN"],
  },
  {
    theme: "Wind in the sails",
    spangram: "SAILING",
    words: ["MAINSAIL", "RUDDER", "KEEL", "MAST", "BOOM", "TILLER", "JIBE",
            "TACK", "HALYARD", "STARBOARD", "TRANSOM", "CLEAT", "SPINNAKER"],
  },
  {
    theme: "Colours of the sky",
    spangram: "SUNSET",
    words: ["CRIMSON", "AMBER", "SCARLET", "VIOLET", "INDIGO", "SAFFRON",
            "CORAL", "PEACH", "ROSE", "GOLD", "BLUSH", "EMBER", "LILAC"],
  },
  {
    theme: "Keep it moving",
    spangram: "ATHLETICS",
    words: ["SPRINT", "HURDLES", "JAVELIN", "DISCUS", "SHOTPUT", "RELAY",
            "MARATHON", "VAULT", "HAMMER", "LONGJUMP", "STEEPLE", "TRACK"],
  },
];
