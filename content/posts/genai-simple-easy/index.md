---
title: "On Generative AI, Simplicity, and Easiness"
date: 2025-10-30T10:00:00Z
draft: false
cover: 
  image: "/images/cover-faster-please.png"
  alt: "Knots from swedish enciclopedia "Nordisk familjebok" (1911), vol.14"
  caption: "Knots from swedish enciclopedia "Nordisk familjebok" (1911), vol.14, on [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nf_knots.png), puvblic domain"
  relative: false
---

Last week I presented a speech at [Linux Day 2025, in Prato](https://day.linux.prato.it/), about meta-search engines. Specifically, I was talking about SearXNG. While preparing the slides for the speech, I came across [articles](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/) talking about "AI Overview", the new feature/product by Google Search giving out answers for your queries in a LLM generated box on top of standard search results. According to many sources, AI Overview has already had a great impact on websites' traffic across many industries since its release: notably, newspapers and websites giving out generic information such as [Wikipedia](https://www.cnet.com/tech/services-and-software/why-wikipedia-is-losing-traffic-to-ai-overviews-on-google/), have seen their traffic reduced. Preliminary research on the topic seems to confirm this trend. 

A few days later, a friend of mine, let's call him "**A**", asked a simple IT-related question in a private WhatsApp group. Another friend of ours, let's call him "**B**", used AI Overview to find that specific information and to answer my friend back by screenshotting Google's answer. **B had absolutely no knowledge** about the specific thing he was looking for, he did the thing that was the **easiest** to him in that moment (ask an LLM) and got a decent answer back. It was the first time I witnessed someone using AI Overview to answer a question posed by someone else in my social bubble.

This kind of interaction is not special by any means, similar things happen every day since the pervasive advent of Large Language Models into our lives: people use Gen AI to easily get information that would otherwise be pretty simple to extract from articles or tabular data (usually lying at the first positions of search engine results), and they tend to trust whatever information the LLM spits out stochastically. But in this specific case I am not interested in writing about the accuracy of LLMs in giving correct answers.

In fact, let us assume the answers of these models are always correct, and let's talk about aspects that are incidental to the usage of LLMs but are, I think, pretty central in how these technologies will shape our future: **simplicity and easiness**.

## Simple vs Easy

In his (great) talk, [Simple Made Easy](https://www.infoq.com/presentations/Simple-Made-Easy/), [Rich Hickey](https://en.wikipedia.org/wiki/Rich_Hickey) explains his point of view on the differences between two words (and concepts) that are frequently used as synonyms: **simple and easy**. I will briefly summarize his view here for the sake of my reasoning.

Rich explains that **simple** (as opposed to complex), refers to the way things are **intertwined**. Think about a single rope (or many ropes) that may be twisted. In fact, a somewhat archaic verb to refer to this activity in English is: **to complect**. By complecting the rope, you may create knots of increasing **complexity**. This concept comes straight from the Latin etymology of [simplex](https://en.wiktionary.org/wiki/simplex). Complexity can refer to a variety of domains: business processes, human relationships, hardware design, and so on, I think you get the point. All these things may be complex, and complexity is something that has to do with the thing itself. In Rich's own words, simple is "an objective notion". **LLMs**, their underlying theory, and products built on top of them, **are complex**. They are complex for anyone: for you, using the end product without knowing how it's made internally, for the ML Engineer that built it, for the Researcher who envisioned it. This is an objective property of the technology, and I think most would agree.

On the other hand, when something is **easy** (as opposed to hard), it means that it is something "in reach", "adjacent", but also "near to our understanding", "familiar", "near to our capabilities", citing Hickey. In fact, the etymology seems to be rooted in Latin, through the word [ease](https://en.wiktionary.org/wiki/ease). Hard has a different [(and interesting)](https://en.wiktionary.org/wiki/hard) etymology altogether, but we don't care about that too much, let's just take that as the opposite of easy.

> 💡 One of my favorite quotes from Hickey's talk is: "If you want everything to be familiar, you will never learn anything new, because it can't be significantly different from what you already know". This might be the focal point of my whole essay.

I hope you can see that **easy** embodies **relativity** if you view it like this, something is easy depending on where you position yourself (both physically and/or metaphorically) in the space of the problem you are trying to solve: reaching the top of Mt. Everest is hard if you are 1000km away, but I'd say it is easy (even trivial), if you are just a couple of meters away from the summit.

I think that this pattern translates well to the the interactions we have with LLMs as individuals (and as a society in whole), and what we get back from them.

## Does ease imply simplicity?

**Interacting** with products that have been augmented someway, is **inherently easy**, if you already knew the product well. In fact, let's go back to the addition of AI Overview on top of Google Search results: it is a perfect example of what I'm trying to show. You already knew how to use Google Search, it's **easy** for you to just use the new AI functionalities (not that you ever had a choice, if you ask me). It seems to me that this kind of "easing" is also what drives adoption for new functionalities in products, new steps in already-solid processes, new technologies in a well-known codebase, and so on. For this reason, I don't consider this kind of ease to be bad by itself. 

Other than that, think about the fact that it's also **easier** **to just read the answer** **for your questions** straight in the AI-generated overview box. What I argue is making something easier has **no effect at all on the underlying complexity**.  My friend's problem was already simple; it wasn't simplified by the ease of the interaction with Google's AI Overview. Had he searched for information about some pretty complex topic such as aerospace engineering, he would have had an easy answer by the LLM, but the topic would have remained complex. 

The point I'm trying to make (and that Rich centers perfectly in his talk) is that **Simplicity and Ease are orthogonal dimensions**, they can grow and shrink independently.

## Easing your life

Just to be clear, **I'm not a luddite**: I use Generative AI daily, I'm just trying to make a point about what blindly using these technologies might cause in our society. Let's then talk about how LLM-powered products are impacting some fields of the industry.

If you work in the Information Technology sector, you may think Gen AI will impact you the most. News of layoffs are so frequent nowadays that it's almost impossible to keep up with that. Products such as Github Copilot, Anthropic Claude Code, Cursor, and so on have a **tangible easing effect** in the Software Development process. What they do not impact, is the **inherent complexity of Software Engineering**, and this is something that many executives across the industry are trying hard not to see (whether this is intentional or not, is a matter of discussion. I personally think this is a deliberate communication choice to devalue human contribution and motivate layoffs). Software Engineering as a discipline has a lot of intertwined aspects that make it complex: people, code, policies, processes, and so on. This is something that Generative AI is **not able to simplify** by itself. Just to bring another example, GenAI doesn't make Distributed Systems any simpler, no matter how it easy it makes creating a single Microservice. For this reason, as Software Engineers, **we should probably reconsider** the impact that Generative AI will have on Software Engineering in the long run and we should instead focus on strengthening our fundamentals.

If you are a creative, AI has already impacted your daily life: social media are invaded by AI-generated content, and some of them are pretty convincing, at least at first glance. The main point here is that photographic composition, illustration, creative writing, filmmaking, **are still as complex as before**, no matter the shiny new model that gets released by the industry. In fact, many of the best AI-generated art comes from people that already had a long exposure to "traditional" techniques. It's very rare that someone with no artistic background at all would come up with a meaningful piece of art by just using ChatGPT. If I were an artist, I'd probably **ignore the ease given to others by these technologies** and I would instead focus on my creative process, whether that may involve Generative AI or not.

Finally, let's talk about people that have no specific use case for LLMs, i.e., most people out there, going back to the concept of ease as "something that is near to our understanding". By accepting the constant "easing" process brought to you by LLMs, you are giving away a lot of learning opportunities. You don't get exposed to a new technology or art technique, you are deliberately ignoring chances to improve yourself and your understanding of the world you live into. You are not exposing yourself to real complexity; instead, you are hiding it under the carpet of ease. Most importantly, you are not experiencing your existence on this planet as a growth process. Using an LLM to vibe code a weekend project or to generate funny images to send your friends is perfectly fine, but using it for everything will probably leave you empty in the long run. This is why I consider products such as AI Overview to be harmful to our society as a whole. In the case of my friend B, he could have used the opportunity given by A's questions to read a webpage on that specific topic for a couple of minutes, but he decided to just screenshot Google's AI answer and send it back to our WhatsApp group. I have a strong feeling that if similar interactions become more common, our society might be greatly impacted.

> 💡 In fact, I really like GenAI as a technology, and I think that many tools and products (whether commercial or Free/Open Source), when used responsibly, may have a great potential for enabling growth both for single persons and for society as a whole. Governments and private companies should invest in training employees and citizens in the correct usage of this technology, stressing its benefits while still warning them about the intrinsic risks it poses when used unresponsibly.

What you get back by this pervasive easing process enabled by LLM-powered products is time, but it's often **empty time**, that many will probably invest in doomscrolling on social network apps (that are engineered to trigger your feelings and keep you hooked for as long as possible, but this is another story). Try to imagine a Software Engineer that fires up a coding agent and then scrolls Instagram instead of reading the documentation for the library he is trying to integrate in the project: he won't learn anything by the process, and will damage himself in the long run. By constantly repeating similar patterns, it's easy to wither both as a professional and as a human being.

## Takeaways

I wrote this mostly for myself, since I had to put down some of the thoughts that had been flying around my mind in the past few days, but, if I were to give you (and to myself) some takeaways, it would be these:

1. When possible, try to use Generative Ai **to make things simpler, and to help you make simple things** that may be composed **when** needed to enable complex behavior. In Software Engineering you should not use GenAI to produce architectures or patterns you are not already familiar with. If you do that (complecting without real knowledge) you are shooting yourself in the foot with the starting gun.
2. Whatever your job may be, use Generative AI **to enable learning first**, and only use it for end-to-end delivery purposes after you are comfortable in the task's domain. Most importantly, don't use it to avoid domain complexity: eventually you will be exposed for your shortcomings.
3. It's not inherently bad to ease something that is already simple, but **always try to reason about the consequences** of such a choice. It might be the case that a little friction would reward you much more than taking the easy route, especially in the long run.

I sincerely thank you if you made it this far, and I hope to have sparked some curiosity on these topics.

Tommaso

---

### Appendix: what I read lately

This is a non-exhaustive list of what I have been reading lately. I'm pretty sure many of these things influenced my thinking. No one is free from bias.

- [Consuming Life - Zygmunt Bauman](https://realsociology.edublogs.org/files/2013/09/168709399-Zygmunt-Bauman-Consuming-Life-2007-1107cis.pdf)
- [Four Thousand Weeks: Time Management for Mortals - Oliver Burkeman](https://en.wikipedia.org/wiki/Four_Thousand_Weeks:_Time_Management_for_Mortals)
- Excerpts from [The Age of Surveillance Capitalism - Shoshana Zuboff](https://en.wikipedia.org/wiki/The_Age_of_Surveillance_Capitalism)
- A lot of technical articles and academic research papers on Gen AI
- Many LinkedIn posts and opinions by [Morten Rand-Hendriksen](https://www.linkedin.com/in/mortenrandhendriksen?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app)
- Many articles about [Enshittification](https://en.wikipedia.org/wiki/Enshittification), by [Cory Doctorow](https://en.wikipedia.org/wiki/Cory_Doctorow)