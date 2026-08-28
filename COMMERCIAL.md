# Commercial use

NostrMediaClient is released under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). Everything below is a plain
summary — the licence text is what actually binds.

## What is already allowed, at no cost

- Running the client for yourself, your own publishing, your own media.
- Studying it, changing it, and running your changed version.
- Redistributing it, with or without changes, under the same terms.
- Use by charities, schools, universities, public research bodies, public
  safety and health organisations, environmental groups, and government
  institutions — **regardless of how they are funded**.
- Hobby projects, experiments, teaching, and research.

You do not need to ask permission for any of the above, and you do not owe
anything for it.

## What needs a separate agreement

Anything done **for commercial advantage**: selling the client or a derivative,
running it as a paid service, bundling it into a commercial product, or using
it internally to run a for-profit business.

That is not a "no". It is an invitation to talk: open an issue at
<https://github.com/Tbc159/NostrMediaClient/issues> saying what you have in
mind. Terms are negotiable and small projects are treated as such.

## Why this licence and not MIT

Two reasons, stated plainly.

The first is that this client handles **private keys and personal media**. A
fork that quietly weakens the key handling, ships a hosted version that touches
the user's key, or wraps it in a paid product with a broken security model does
real damage to people who trust the name. The licence does not prevent that, but
it makes the commercial version of that scenario a conversation instead of a
surprise.

The second is honesty about sustainability: an author who can be reached and
occasionally paid maintains a project longer than one who cannot.

**This is not an open source licence** as the Open Source Initiative defines it,
because it restricts a field of use. GitHub will not label it as open source, it
is incompatible with GPL-licensed projects, and some companies avoid such
licences on principle. That trade-off is deliberate.

## Supporting the project

Nothing here is required, and nothing is paywalled behind it.

- **Report what breaks.** A precise bug report with the relay or Blossom server
  involved is worth more than most patches.
- **Test against your own relay.** Most of the interesting failures in this
  project came from real endpoints behaving unlike the specification.
- **Send a patch.** Contributions are accepted under the same licence; by
  opening a pull request you agree that your contribution may be relicensed by
  the author, including for the commercial licences described above.
- **Zap or sponsor.** See the contact details in the [README](README.md).
