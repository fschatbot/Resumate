We are going to be building an MCP tool for the browser. This tool will have three parts to it.

Description:
This project has 2 main moving components. The first component allows an AI agent to connect to the browser and use any and all tools that it may need. The second component tells the AI what to do exactly in order to fill out a job application form perfectly.

Files to read before building all the tools:

- cleanTools1.js
- CleanToolsSPEC1.md
- cleanTools2.js
- CleanToolsSPEC2.md
- claude/manifest.json
- browsemcp/manifest.json

You may use the following URLS to gain additional information, details, or idea:

- https://github.com/microsoft/playwright-mcp

Browser Extension:
This browser extension will be installed by the client on their browsers. This will provide all the actual tools and resources for the AI agent to use. In order to see the various kinds of tools that are already avaible please check the cleanTools and cleanToolsSpec. Ensure Zod validation and report back feedback for success or failure details. The clean Tools and Specs have been pulled and created as two different versions with very little overlap in their functionality. You must take the best of both worlds and combine as much as possible for different use-case.

The code and specs provided are not final in any way or form. They are simple implementations that are to be used as reference rather than final answers. Ensure there are layers of validation, complete context, and proper implemention.

For this extension, when the user clicks the browser extension they are to be greeted with a side panel(togglable) on that page. The page will be put under a tab group. Only the tabs inside the tab group are visible and rest are hidden. On the side panel, it first showcase a connection beacon animation. This basically is stating that it is waiting for the AI agent send its first request to the TAB grop. Small statistics is shown on the top which will contain the amount of tools called, tab ID, files (such as screenshots or images) exported or imported, etc.

Then it will showcase a list of all the tools that have been called on the active page. On hover it will display the date and time of call in a tooltip. Batched toolcalls will be inside a bigger container. If it is a file, it will show up as a link. If the text ini the arguments are too long it will truncate (on hover expand to full).

The extension has additional capabilities and features.
The extension can also hold its own files if any of the tools ever need to reference anything from it.

The extension has another section/tab in the panel that allows it to switch to an inbuilt wrapper. In this tab, the user is told to either connect their gemini, open ai, claude, or general AI agent. When clicked on gemini, open ai, or claude they can either connect it directly by connecting with their accounts or by inputting an API key. This will automatically load in the bridge, AI skill, and all the required context directly and wrap it into an chat wrapper. This way the user doesn't need to connect a desktop version and can simply do it directly from the browser.

At the end, the extension can either be standalone component or can work as an underlying component for another.

MCP Tool:
Since, a browser extension (behaving as an MCP) cannot be the entire thing as desktop applications need a way to connect to it. This is a tool that can be hosted on the client's machine. This tool connects directly with the browser extension and works as a proxy so that it can relay all the tools, descriptions, context, resources, etc. This will act as the bridge to the actual MCP and the AI agent. This will contain a schema validation tool that verifies the validity of the schema and its sections. It also is responsible for switching in the details from the schema into the tool details when required.

AI Skill:
This skill will detail just how exactly should the AI agent use the MCP tool and how it should interact with the browser. The skill will first ask the AI to process the resume.pdf and resume.md to create a preference.json file that will contain all the information in a particular schema. This is the initialization.
Then the AI agent will asked by the human to fill out the resume for the particular tabb. It should go there and check for connection and details. Then it should do one dom read and one screenshot read. It must then fill out the entire form as requied. It is told to use batching as much as possible. It should naturally, hover, focus/click, type in a field. Wait a little, then move on. Basically it must simulate a human like behavior. It must fill out multiple sections of the form in one batching as much as possible. Parts of the form which contain complicated elements should be left to be done at last. It must also verify its work. If the information not found in the preferences then it should simply ask the user if the question is simple. It should tell the user a summary of all the work done and all the work the user has to do. Pointers only. Avoid filling out sections of form for which the answer is not provided in the preference.json. Update the json if the user provides more details. The MCP tools will contain a tool that would help keep the schema valid.

When the AI calls the tools, it can reference the sections from the preferences directly. THIS IS PREFFERED AS DEFAULT BEHAVIOR. Example: If ask for the full name the AI tool would type "${preferences.general.fistName} ${preferences.general.lastName}" instead of "John Doe" when possible. The AI may type the answer directly if there might be a formating clash between the form and the preference.json string format.

The schema also needs to be created and must look something like this:

- General Info:
  - Name, number, prefered location, prefered date, known languages, phone country, phone 10 digits
- Education Details:
  - Detail 1:
    - Name, Location, Dates, GPA, etc
  - Pointers:
    - Pointer 1
    - Pointer 2
    - Pointer 3
- Awards:
  - Detail 1:
    - ...
- Experiences:
  - Detail 1:
    - ...
- Projects:
  - Detail 1:
    - ...
- ETC
