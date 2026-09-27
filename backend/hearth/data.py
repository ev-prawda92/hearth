"""Fictional Hearth marketplace data: reservations and help-center articles."""
from __future__ import annotations

AS_OF = "2026-09-26"  # demo clock, fixed so evaluations are reproducible

RESERVATIONS: dict[str, dict] = {
    "HT-1042": {
        "id": "HT-1042", "role": "guest", "name": "Maya", "listing": "Alfama two-bedroom apartment", "city": "Lisbon",
        "policy": "Flexible", "booked": "2026-08-30", "check_in": "2026-10-02", "check_out": "2026-10-06",
        "nightly": 118, "cleaning": 45, "cur": "€", "guests": 3,
        "entry": "lockbox", "entry_detail": "lockbox by the green door; the code arrives 24 hours before check-in",
        "check_in_time": "15:00", "check_out_time": "11:00", "pets": False, "host": "Inês", "status": "upcoming",
        "art": {"scene": "city", "hue": 18},
    },
    "HT-2218": {
        "id": "HT-2218", "role": "guest", "name": "Daniel", "listing": "Ridge-line cabin", "city": "Asheville",
        "policy": "Strict", "booked": "2026-09-10", "check_in": "2026-09-30", "check_out": "2026-10-03",
        "nightly": 240, "cleaning": 85, "cur": "$", "guests": 4,
        "entry": "smart lock", "entry_detail": "smart lock; your code is the last four digits of your phone number",
        "check_in_time": "16:00", "check_out_time": "10:00", "pets": True, "pet_fee": 40, "host": "Carla", "status": "upcoming",
        "art": {"scene": "cabin", "hue": 140},
    },
    "HT-3307": {
        "id": "HT-3307", "role": "guest", "name": "Priya", "listing": "Roma Norte loft", "city": "Mexico City",
        "policy": "Moderate", "booked": "2026-09-02", "check_in": "2026-09-24", "check_out": "2026-09-29",
        "nightly": 96, "cleaning": 30, "cur": "$", "guests": 2,
        "entry": "host greets", "entry_detail": "Luis meets you at the building entrance",
        "check_in_time": "14:00", "check_out_time": "12:00", "pets": False, "host": "Luis", "status": "in stay",
        "art": {"scene": "loft", "hue": 330},
    },
    "HT-5120": {
        "id": "HT-5120", "role": "guest", "name": "Jordan", "listing": "Wicker Park flat", "city": "Chicago",
        "policy": "Moderate", "booked": "2026-09-01", "check_in": "2026-09-28", "check_out": "2026-09-30",
        "nightly": 150, "cleaning": 60, "cur": "$", "guests": 2,
        "entry": "keypad", "entry_detail": "keypad on the side door; your code is in the reservation thread",
        "check_in_time": "15:00", "check_out_time": "11:00", "pets": False, "host": "Sam", "status": "upcoming",
        "art": {"scene": "flat", "hue": 215},
    },
    "HT-6031": {
        "id": "HT-6031", "role": "guest", "name": "Aiko", "listing": "Machiya townhouse", "city": "Kyoto",
        "policy": "Flexible", "booked": "2026-09-20", "check_in": "2026-09-26", "check_out": "2026-09-29",
        "nightly": 21000, "cleaning": 6000, "cur": "¥", "guests": 2,
        "entry": "smart lock", "entry_detail": "smart lock on the wooden gate; the code is in the reservation thread",
        "check_in_time": "15:00", "check_out_time": "10:00", "pets": False, "host": "Kenji", "status": "arriving today",
        "art": {"scene": "townhouse", "hue": 40},
    },
    "HT-4410": {
        "id": "HT-4410", "role": "host", "name": "Tom", "listing": "Garden cottage", "city": "Portland",
        "last_stay": {"guest": "Ren", "check_out": "2026-09-22", "earnings": 612, "paid": "2026-09-16"},
        "next_stay": {"guest": "Alma", "check_in": "2026-09-28", "check_out": "2026-10-01", "earnings": 455},
        "cur": "$", "policy": "Moderate", "status": "hosting",
        "art": {"scene": "cottage", "hue": 95},
    },
}

# Keywords are written naturally; the engine stems them once at load time.
ARTICLES: list[dict] = [
    {"id": "HC-01", "title": "Cancel a reservation", "audience": "guest",
     "kw": ["cancel", "cancellation", "refund", "money back", "get back", "call off", "can't make it", "cant make it",
            "leave early", "leave tomorrow", "anything back", "cut the trip short", "unused nights"],
     "followups": ["When would the refund arrive?", "Can I change my dates instead?", "Talk to a person"]},
    {"id": "HC-02", "title": "When a refund arrives", "audience": "both",
     "kw": ["refund arrive", "haven't received", "havent received", "not received", "still waiting", "how long",
            "processing", "bank", "pending refund", "show up", "on my card", "where is my money", "where's my money",
            "where is my refund", "where's my refund"],
     "followups": ["Talk to a person"]},
    {"id": "HC-03", "title": "Change dates or guests", "audience": "guest",
     "kw": ["change dates", "change my dates", "change the dates", "modify", "extend", "extra night", "another night",
            "add a guest", "more guests", "more people", "extra people", "extra guests", "bring a friend", "alteration",
            "shorten", "move my", "different dates", "reschedule", "postpone", "push the reservation",
            "push my", "join", "additional guest", "additional person", "another person", "one more person"],
     "followups": ["How much would I get back if I cancel?", "Talk to a person"]},
    {"id": "HC-04", "title": "Can't get into the listing", "audience": "guest",
     "kw": ["can't get in", "cant get in", "locked out", "lockbox", "door code", "code", "key", "access", "won't open",
            "wont open", "door", "get inside", "entry", "keypad", "smart lock", "get in", "let us in", "enter"],
     "followups": ["Rebook me somewhere nearby", "Talk to a person"]},
    {"id": "HC-05", "title": "Listing isn't as described", "audience": "guest",
     "kw": ["dirty", "not as described", "not clean", "hot water", "wifi", "wi fi", "internet", "missing",
            "doesn't match", "different from the photos", "photos", "smell", "bugs", "broken", "not working",
            "heating", "air conditioning", "ac", "noisy", "construction", "roach", "cockroach", "mice", "mouse",
            "rat", "insect", "pest", "bed bug", "bedbug", "mold", "leak", "shower", "toilet", "fridge"],
     "followups": ["Rebook me somewhere nearby", "Talk to a person"]},
    {"id": "HC-06", "title": "When hosts get paid", "audience": "host",
     "kw": ["payout", "get paid", "earnings", "transfer", "deposit", "money from", "payment for", "when do i get", "paid"],
     "followups": ["Talk to a person"]},
    {"id": "HC-07", "title": "Report damage after a stay", "audience": "host",
     "kw": ["damage", "broke", "broken", "stain", "claim", "reimburse", "reimbursement", "ruined", "cracked", "trashed",
            "mess", "destroyed"],
     "followups": ["When do I get paid for my next booking?", "Talk to a person"]},
    {"id": "HC-08", "title": "Pets and assistance animals", "audience": "guest",
     "kw": ["pet", "dog", "cat", "puppy", "animal", "service animal", "service dog", "assistance animal"],
     "followups": ["What time is check-in?", "Talk to a person"]},
    {"id": "HC-09", "title": "Check-in and checkout times", "audience": "guest",
     "kw": ["check in time", "checkin time", "checkout time", "check out time", "what time", "when can i check in",
            "early check in", "late checkout", "late check out", "arrive early", "leave late", "check in:1", "checkout:1", "check out:1", "latest:1", "earliest:1"],
     "followups": ["How do I get inside?", "Talk to a person"]},
    {"id": "HC-10", "title": "Receipts and invoices", "audience": "both",
     "kw": ["receipt", "invoice", "vat", "expense", "tax document", "proof of payment", "statement", "tax"],
     "followups": ["Talk to a person"]},
    {"id": "HC-11", "title": "Cancel as a host", "audience": "host",
     "kw": ["cancel", "cancellation", "call off", "can't host", "cant host"],
     "followups": ["Talk to a person"]},
]

SAFETY_TERMS = [
    # medical
    "emergency", "medical", "injured", "injury", "hurt", "fell", "bleeding", "ambulance", "911", "hospital",
    "unconscious", "passed out", "pass out", "won't wake up", "wont wake up", "not breathing", "can't breathe",
    "cant breathe", "seizure", "allergic reaction", "chest pain", "overdose", "choking", "drowning",
    # environment
    "fire", "smoke alarm", "smoke detector", "smell smoke", "full of smoke", "smoke coming", "gas", "carbon monoxide",
    "sparks", "exposed wire", "electrical fire", "flood", "flooding", "ceiling fell", "collapsed",
    # personal safety
    "unsafe", "scared", "scary", "afraid", "making me uncomfortable", "feel uncomfortable", "creepy", "threaten",
    "harass", "harassment", "stalking", "following me", "watching me", "won't leave", "wont leave",
    "without permission", "let himself in", "let herself in", "came in without", "messaging me at night",
    "hidden camera", "camera in", "assault", "attacked", "weapon", "gun", "knife", "dangerous", "violent", "police",
    # property crime
    "break in", "broke in", "trying to get in", "stole", "stolen", "robbed", "burglary", "took our", "took my",
]
SENSITIVE_TERMS = ["lawyer", "sue", "chargeback", "dispute", "fraud", "scam", "racist", "racism", "discriminate",
                   "discrimination", "legal action"]
HUMAN_TERMS = ["real person", "human", "agent", "representative", "talk to someone", "speak to someone",
               "talk to a person", "speak to a person", "live person", "customer service", "escalate", "rebook"]
STATUS_CUES = ["already", "still", "haven't", "havent", "hasn't", "hasnt", "isn't", "not received", "yet", "last week",
               "where is", "where's"]
HYPOTHETICAL_CUES = ["can i", "could i", "if i", "should i", "would i", "how much", "do i get"]
