"""Writes the labeled evaluation sets. Holdout cases were written before engine v2 was run on them."""
import json
from pathlib import Path

H = "HANDOFF"
DEV = [
    # original 28 (v1 set)
    ("HT-1042", "I need to cancel my trip, how much will I get back?", "HC-01", ["€517"], "cancel"),
    ("HT-2218", "Can I get a refund if I cancel?", "HC-01", ["$85"], "cancel"),
    ("HT-3307", "We have to leave early, can we get money back for the nights we won't use?", "HC-01", ["$96"], "cancel"),
    ("HT-1042", "My refund still hasn't arrived, it's been a week", "HC-02", ["5–10 business days"], "refund"),
    ("HT-2218", "How long does a refund take to show up on my card?", "HC-02", ["5–10 business days"], "refund"),
    ("HT-1042", "Can I add an extra night to my stay?", "HC-03", ["Oct 2–Oct 6"], "change"),
    ("HT-2218", "I want to change my dates to the following weekend", "HC-03", ["Sep 30–Oct 3"], "change"),
    ("HT-1042", "The lockbox code isn't working and I'm standing outside", "HC-04", ["lockbox"], "access"),
    ("HT-2218", "How do I get inside when I arrive?", "HC-04", ["smart lock"], "access"),
    ("HT-3307", "There's no hot water and the wifi is down", "HC-05", ["72 hours"], "quality"),
    ("HT-3307", "The place is dirty and doesn't match the photos", "HC-05", ["72 hours"], "quality"),
    ("HT-4410", "When do I get paid for my next booking?", "HC-06", ["$455", "Sep 29"], "payout"),
    ("HT-4410", "My guest broke a lamp and stained the couch, how do I get reimbursed?", "HC-07", ["Oct 6"], "damage"),
    ("HT-2218", "Can I bring my dog?", "HC-08", ["allows pets"], "pets"),
    ("HT-1042", "Is it ok to bring our cat along?", "HC-08", ["doesn't allow pets"], "pets"),
    ("HT-1042", "What time is check-in? Can we arrive early?", "HC-09", ["15:00", "11:00"], "times"),
    ("HT-3307", "Could we get a late checkout on our last day?", "HC-09", ["14:00", "12:00"], "times"),
    ("HT-1042", "I need an invoice with VAT for my company expenses", "HC-10", ["Trips → HT-1042 → Get receipt"], "receipt"),
    ("HT-4410", "I have to cancel my next guest, what happens?", "HC-11", ["2 days", "50% fee"], "cancel"),
    ("HT-3307", "The heating is broken, can I cancel and get a refund?", H, "specialist", "multi"),
    ("HT-3307", "There's a man outside the door and I feel unsafe", H, "safety", "safety"),
    ("HT-1042", "I smell gas leak in the kitchen", H, "safety", "safety"),
    ("HT-3307", "I found a hidden camera in the bedroom", H, "safety", "safety"),
    ("HT-2218", "The host threatened me when I asked about the deposit", H, "safety", "safety"),
    ("HT-2218", "I'm filing a chargeback with my bank if this isn't fixed", H, "trust", "trust"),
    ("HT-2218", "Is there good hiking near the cabin?", H, "specialist", "other"),
    ("HT-2218", "The door won't open with the code my host sent", "HC-04", ["smart lock"], "access"),
    ("HT-4410", "When will I receive the money from my last guest?", "HC-06", ["$612"], "payout"),
    # probe round 1 (found 8 misses in v1)
    ("HT-1042", "I need to cancle my booking", "HC-01", ["€517"], "cancel"),
    ("HT-1042", "how much refnd would i get if i cancel", "HC-01", ["€517"], "cancel"),
    ("HT-1042", "I don't want to cancel, I just want to change my dates", "HC-03", ["Oct 2–Oct 6"], "change"),
    ("HT-1042", "I already cancelled, where is my money?", "HC-02", ["5–10 business days"], "refund"),
    ("HT-2218", "I cancelled last week and the refund still isn't on my card", "HC-02", ["5–10 business days"], "refund"),
    ("HT-1042", "Can I talk to a real person please", H, "specialist", "human"),
    ("HT-3307", "get me a human agent", H, "specialist", "human"),
    ("HT-3307", "someone is trying to get into the apartment, I'm scared", H, "safety", "safety"),
    ("HT-3307", "my kid fell and is bleeding, where is the nearest hospital", H, "safety", "safety"),
    ("HT-1042", "the smoke alarm keeps going off", H, "safety", "safety"),
    ("HT-1042", "is the fireplace ok to use? also what time is check in", "HC-09", ["15:00"], "times"),
    ("HT-2218", "what's the wifi password and the door code", "HC-04", ["smart lock"], "access"),
    ("HT-2218", "do you allow service dogs", "HC-08", ["allows pets"], "pets"),
    ("HT-4410", "where's my payout", "HC-06", ["$455"], "payout"),
    ("HT-4410", "I need to cancel on my guest because of a pipe leak", "HC-11", ["50% fee"], "cancel"),
    ("HT-4410", "the guest left the place trashed", "HC-07", ["Oct 6"], "damage"),
    ("HT-1042", "can you email me a receipt", "HC-10", ["Trips → HT-1042 → Get receipt"], "receipt"),
    ("HT-3307", "the AC is not working and it's 35 degrees", "HC-05", ["72 hours"], "quality"),
    ("HT-1042", "the host is being racist to me", H, "trust", "trust"),
    ("HT-2218", "can we bring 2 more people", "HC-03", ["Sep 30–Oct 3"], "change"),
    ("HT-1042", "when can I check in", "HC-09", ["15:00"], "times"),
    ("HT-3307", "if I leave tomorrow instead do I get anything back", "HC-01", ["$96"], "cancel"),
    ("HT-2218", "I want a full refund, this is ridiculous, I'm disputing the charge", H, "trust", "trust"),
    ("HT-1042", "I'm locked out", "HC-04", ["lockbox"], "access"),
]

# Holdout 1: written before engine v2 ran on it; scored once (see history.json), then folded into dev.
HOLDOUT1 = [
    ("HT-5120", "we might not make it, what happens if we cancel?", "HC-01", ["$210"], "cancel"),
    ("HT-6031", "My flight got cancelled so I need to cancel tonight's booking. Refund?", "HC-01", ["¥48,000"], "cancel"),
    ("HT-5120", "cancelation refund amount?", "HC-01", ["$210"], "cancel"),
    ("HT-2218", "It's been two weeks and I still haven't gotten my refund back", "HC-02", ["5–10 business days"], "refund"),
    ("HT-5120", "Could I push the reservation to next month?", "HC-03", ["Sep 28–Sep 30"], "change"),
    ("HT-6031", "Can a third friend join us?", "HC-03", [], "change"),
    ("HT-5120", "the keypad isn't accepting my code", "HC-04", ["keypad"], "access"),
    ("HT-6031", "How do we get in when we arrive?", "HC-04", ["smart lock"], "access"),
    ("HT-3307", "there are cockroaches in the kitchen", "HC-05", ["72 hours"], "quality"),
    ("HT-3307", "The shower is broken and water is leaking", "HC-05", ["72 hours"], "quality"),
    ("HT-4410", "How much is my next payout and when does it arrive?", "HC-06", ["$455"], "payout"),
    ("HT-4410", "The guests cracked the glass table, can I file a claim?", "HC-07", ["Oct 6"], "damage"),
    ("HT-5120", "Are dogs allowed at this place?", "HC-08", ["doesn't allow pets"], "pets"),
    ("HT-6031", "What's the latest we can check out?", "HC-09", ["10:00"], "times"),
    ("HT-4410", "I need a statement of my earnings for taxes", "HC-10", ["Hosting → Earnings → Get statement"], "receipt"),
    ("HT-5120", "Someone just broke in and took our bags", H, "safety", "safety"),
    ("HT-6031", "My friend passed out and won't wake up", H, "safety", "safety"),
    ("HT-2218", "There's a strong smell of gas near the stove", H, "safety", "safety"),
    ("HT-1042", "The host keeps messaging me at night and it's making me uncomfortable", H, "safety", "safety"),
    ("HT-5120", "I'm going to report this listing as a scam", H, "trust", "trust"),
    ("HT-3307", "Can I speak with someone from customer service?", H, "specialist", "human"),
    ("HT-2218", "What's a good restaurant in town?", H, "specialist", "other"),
]

# Holdout 2: written after v2.1's fixes and before v2.1 ran on it. Not used for tuning.
HOLDOUT2 = [
    ("HT-1042", "Something came up and we can't travel anymore. What do we get refunded?", "HC-01", ["€517"], "cancel"),
    ("HT-5120", "Is it too late to cancel for a full refund?", "HC-01", ["$210"], "cancel"),
    ("HT-6031", "i need to cancell, what's the refund", "HC-01", ["¥48,000"], "cancel"),
    ("HT-3307", "The refund from my old booking never showed up in my account", "HC-02", ["5–10 business days"], "refund"),
    ("HT-2218", "Can we arrive a day later and stay an extra night at the end?", "HC-03", ["Sep 30–Oct 3"], "change"),
    ("HT-1042", "we're now 4 people instead of 3, is that ok?", "HC-03", ["Oct 2–Oct 6"], "change"),
    ("HT-6031", "The gate won't unlock", "HC-04", ["smart lock"], "access"),
    ("HT-1042", "where do I find the key?", "HC-04", ["lockbox"], "access"),
    ("HT-3307", "the toilet is clogged and overflowing", "HC-05", ["72 hours"], "quality"),
    ("HT-3307", "it's really loud at night because of the bar downstairs", "HC-05", ["72 hours"], "quality"),
    ("HT-4410", "has my money for Ren's stay been sent?", "HC-06", ["$612"], "payout"),
    ("HT-4410", "they spilled wine all over the rug, what can I do", "HC-07", ["Oct 6"], "damage"),
    ("HT-2218", "we're traveling with our puppy, any extra charge?", "HC-08", ["allows pets"], "pets"),
    ("HT-5120", "Can we drop our bags before 3pm?", "HC-09", ["15:00"], "times"),
    ("HT-1042", "I need a copy of the invoice", "HC-10", ["Trips → HT-1042 → Get receipt"], "receipt"),
    ("HT-6031", "There's smoke coming from the kitchen", H, "safety", "safety"),
    ("HT-3307", "My daughter is having an allergic reaction, what do I do", H, "safety", "safety"),
    ("HT-2218", "A stranger walked into our cabin without knocking", H, "safety", "safety"),
    ("HT-5120", "I think someone stole my laptop from the apartment", H, "safety", "safety"),
    ("HT-1042", "The host said he'd leave a bad review unless I pay him cash", H, "trust", "trust"),
    ("HT-3307", "put me through to support staff", H, "specialist", "human"),
    ("HT-6031", "Do you know any good temples to visit?", H, "specialist", "other"),
]


def write(name, rows, split):
    out = []
    for i, (res, q, expect, extra, topic) in enumerate(rows, 1):
        case = {"id": f"{split[0]}{i:02d}", "split": split, "reservation_id": res, "question": q,
                "expect": expect, "topic": topic}
        if expect == H:
            case["queue"] = extra
        else:
            case["facts"] = extra
        out.append(case)
    p = Path(__file__).resolve().parent.parent / "evals" / f"{name}.jsonl"
    p.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in out) + "\n")
    print(p.name, len(out))


if __name__ == "__main__":
    write("dev", DEV + HOLDOUT1, "dev")
    write("holdout", HOLDOUT2, "holdout")
