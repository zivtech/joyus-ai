NCLC Specific Tasks that we will also leverage AI for that will also figure into the writing piece of the app: 
1) There will need to be a searchable databse of all of their content. Their treatesies are already in version controlled xml files, which we will likely want to maintain, and they also have content in Drupal, on a public website, and on highly sensitive listservs (this is probably also in the NCLC specific spec already- it may be in the ~/claude/claude-files/nclc folder and there are specific confluence documents for NCLC that cover some of this)
2) That database and this application will be controlled by drupal, which already handles access control. Past research suggested using Solr for that part. 
3) When asked for help the chat will not assume it knows everything- it will assume it can make a guess and then will check against the current treatesies. 
4) The system will allow for many different audiences, which will have their own voices. The NCLC profiles, for example, will need to account for at least the following :
    a) Litigator - this is the voice they use in court documents or when fighting the unscrupulous lenders with legal letters and such. 
    b) Advocate - this is the voice they use when speaking to legislators.
    c) Educator - this is the voice they use when speking to the public. 
    d) Expert - this is the voice they use in the books and in articles. They are experts in this legal theory and practice. 
    e) Conumer Advocate "Priest" (the guide for the good guys) - this voice they use to teach other lawyers how to best protect poor people from those who abuse and rob them. At some level this voice is likely a combination of the others, with some "secrets" mixed in. 
5) not only will content be restricted to different authors, but the voice will as well!. Voice e) above is the most important voice, and it will correspond to a lot of content that is already off limits.   
6) There will be a new Consumer Law Repository website (possibly remaining part of the library site), which also already has specs in the NCLC spaces mentioned. This will be used to update the book XML docs as well as enable a method to create "future regulations" based upon Federal Register notices.

The research task here is first of to define each of the systems and sub systems I have mentioned or are implied by what I am saying and then make sure that they are in the system, noting that many of them may be only useful to one client: for example a lot of clients will need a better database for their content to be used by /with AI who likely won't need the otehr tools, but other folks might need the sylometry tools but not the "restricted voice/content" etc. This all needs to be kept seperate and in well designed hierarchies for use in all of the niches we may encounter. 

Other items we will want: 
* enriched AI-focused profiles of authors/experts. 
* a mediated search experience for AI bots to also query public data (currently bots hit site searches too hard causing massive traffic bumps for super obscure and often unavailable content- we want to divert them to something mroe appropriate--and cacheable/scalable) 
* accesiblity scanning and remediation (likely already in the plan)
* the dev environments we build for a11y and bug testing can also be used for content staging. We will have tooling in place to allow for updates to the content db to be pushed to stage->live. 
* it's highly likely that in the end we will also offer hosting, because why not if we're already building the infrastructure for it. This will be a far future item that will require lots of independent research, but just a note for the future. 

I also want to make sure we have both a public roadmap as well as an internal one we're keeping that has these sorts of specific needs in it. I do want to be able to allude to specific features we haven't made public in general terms. 
