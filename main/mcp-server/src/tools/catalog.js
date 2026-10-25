/**
 * tools/catalog.js - Comprehensive Tool Catalog for AutoResume MCP
 *
 * Merges best-of-breed automation primitives from cleanTools1 (CDP, ElementMap,
 * TabConfinement, file uploads) and cleanTools2 (Accessibility Tree, YAML snapshots,
 * semantic locators, batch transactions) with full Zod/JSON Schema validation.
 */

export const TOOL_CATALOG = [
	// --- Navigation & Browser History ---
	{
		name: "browser_navigate",
		description: "Navigate active browser tab to a specified URL, or traverse history ('back' / 'forward'). Handles unsaved beforeunload dialogues safely.",
		inputSchema: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "Target URL (e.g. 'https://jobs.example.com') or history keywords 'back' / 'forward'.",
				},
				force: {
					type: "boolean",
					description: "If true, bypasses unsaved beforeunload confirmation blocks. Default: false.",
				},
				tabId: {
					type: "integer",
					description: "Target tab ID. Defaults to current active MCP tab.",
				},
			},
			required: ["url"],
		},
	},
	{
		name: "browser_go_back",
		description: "Navigate backward in session history for the current tab.",
		inputSchema: {
			type: "object",
			properties: {
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "browser_go_forward",
		description: "Navigate forward in session history for the current tab.",
		inputSchema: {
			type: "object",
			properties: {
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},

	// --- Observation & Inspection (Updated in mcp-server/src/tools/catalog.js) ---
	{
		name: "browser_snapshot",
		description:
			"Extracts a logically compacted semantic accessibility tree or contextual mutation delta of the active page with stable element reference handles (@e1, @e2, etc.). Preserves parent question/section groupings while eliminating layout wrapper noise.",
		inputSchema: {
			type: "object",
			properties: {
				filter: {
					type: "string",
					enum: ["interactive", "all", "delta"],
					description:
						"Filter level: 'interactive' for actionable controls and their parent question/section groups (default); 'all' to include all headings and text landmarks; 'delta' for only mutated elements and alerts since last interaction.",
				},
				deltaOnly: {
					type: "boolean",
					description: "If true, returns only newly added, removed, or changed elements and validation alerts since the last action/snapshot.",
				},
				format: {
					type: "string",
					enum: ["compact", "yaml"],
					description: "Output format: 'compact' (default) returns a token-minimal grouped semantic tree (@e... role \"label\" = \"value\"); 'yaml' returns full hierarchical YAML.",
				},
				rootRefId: {
					type: "string",
					description: "Optional element reference (e.g. '@e10') to scope the snapshot to a specific modal, form, or section.",
				},
				depth: {
					type: "integer",
					description: "Max logical semantic depth. Default: 30.",
				},
				maxChars: {
					type: "integer",
					description: "Maximum characters to return before truncation. Default: 50000.",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "read_page",
		description: "Alias for browser_snapshot. Extracts a logically compacted semantic accessibility tree or mutation delta of the active page.",
		inputSchema: {
			type: "object",
			properties: {
				filter: {
					type: "string",
					enum: ["interactive", "all", "delta"],
					description: "Filter level: 'interactive', 'all', or 'delta'.",
				},
				deltaOnly: {
					type: "boolean",
					description: "If true, returns only changed elements and alerts since last interaction.",
				},
				format: {
					type: "string",
					enum: ["compact", "yaml"],
					description: "Output format: 'compact' or 'yaml'.",
				},
				rootRefId: {
					type: "string",
					description: "Optional element reference (e.g. '@e10') to scope the snapshot to a specific container.",
				},
				depth: {
					type: "integer",
					description: "Max logical semantic depth. Default: 30.",
				},
				maxChars: {
					type: "integer",
					description: "Maximum characters to return. Default: 50000.",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "browser_screenshot",
		description: "Captures a high-resolution PNG screenshot of the visible viewport or full page, returning base64 data and coordinate scaling dimensions.",
		inputSchema: {
			type: "object",
			properties: {
				fullPage: {
					type: "boolean",
					description: "If true, captures full scrollable page. Default: false.",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "find",
		description: "Locates elements matching a natural language query or semantic selector across the accessibility tree.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Natural language description or role of the element (e.g. 'First Name input', 'Upload Resume button').",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
			required: ["query"],
		},
	},
	{
		name: "get_page_text",
		description: "Extracts clean readable text content from the page, prioritizing <main>, <article>, and primary form containers.",
		inputSchema: {
			type: "object",
			properties: {
				maxChars: { type: "integer", description: "Maximum characters to return. Default: 50000." },
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},

	// --- Interaction & Input Simulation ---
	{
		name: "browser_click",
		description:
			"Performs trusted hardware mouse click on an element by reference (@e1, ref_1), semantic label/role, CSS selector, or [x, y] coordinates via DevTools Protocol. Automatically scrolls to element before locating coordinates and clicking with 10 cps (100ms hold) duration. Scrolling default is preferred unless it was followed by a hover.",
		inputSchema: {
			type: "object",
			properties: {
				element: {
					type: "string",
					description: "Element reference (e.g. '@e12', 'ref_1'), semantic role ('button \"Apply\"'), or CSS selector ('#submit-btn').",
				},
				coordinates: {
					type: "object",
					properties: {
						x: { type: "number" },
						y: { type: "number" },
					},
					description: "Optional [x, y] coordinates in screenshot or viewport frame.",
				},
				scroll: {
					type: "boolean",
					description: "Whether to scroll element into view before clicking (default: true). Scrolling default is preferred unless it was followed by a hover.",
				},
				button: {
					type: "string",
					enum: ["left", "right", "middle"],
					description: "Mouse button. Default: 'left'.",
				},
				clickCount: {
					type: "integer",
					enum: [1, 2, 3],
					description: "1 = single click, 2 = double click, 3 = triple click. Default: 1.",
				},
				modifiers: {
					type: "array",
					items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] },
					description: "Keyboard modifier keys held during click.",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "browser_double_click",
		description:
			"Performs trusted double click on an element or coordinate using DevTools Protocol (e.g. to open items or select words). Automatically scrolls and waits for scroll settlement before locating coordinates. Click duration is 10 cps (100ms hold). Scrolling default is preferred unless it was followed by a hover.",
		inputSchema: {
			type: "object",
			properties: {
				element: { type: "string", description: "Element reference or CSS selector." },
				coordinates: {
					type: "object",
					properties: { x: { type: "number" }, y: { type: "number" } },
				},
				scroll: {
					type: "boolean",
					description: "Whether to scroll element into view before clicking (default: true). Scrolling default is preferred unless it was followed by a hover.",
				},
				button: { type: "string", enum: ["left", "right", "middle"], description: "Default: 'left'." },
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "browser_triple_click",
		description:
			"Performs trusted triple click on an element or coordinate using DevTools Protocol (e.g. to select an entire line or paragraph). Automatically scrolls and waits for scroll settlement before locating coordinates. Click duration is 10 cps (100ms hold). Scrolling default is preferred unless it was followed by a hover.",
		inputSchema: {
			type: "object",
			properties: {
				element: { type: "string", description: "Element reference or CSS selector." },
				coordinates: {
					type: "object",
					properties: { x: { type: "number" }, y: { type: "number" } },
				},
				scroll: {
					type: "boolean",
					description: "Whether to scroll element into view before clicking (default: true). Scrolling default is preferred unless it was followed by a hover.",
				},
				button: { type: "string", enum: ["left", "right", "middle"], description: "Default: 'left'." },
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "browser_hover",
		description:
			"Hovers the mouse cursor over an element or coordinate to trigger hover states, tooltips, or dropdown activations. Automatically scrolls smoothly into view and waits for scroll to end before locating coordinates. Scrolling default is preferred unless it was followed by a hover.",
		inputSchema: {
			type: "object",
			properties: {
				element: { type: "string", description: "Element reference or CSS selector." },
				coordinates: {
					type: "object",
					properties: {
						x: { type: "number" },
						y: { type: "number" },
					},
				},
				scroll: {
					type: "boolean",
					description: "Whether to scroll element into view before hovering (default: true). Scrolling default is preferred unless it was followed by a hover.",
				},
				duration: {
					type: "integer",
					description: "Duration to maintain hover state in milliseconds (minimum 100ms, default 150ms).",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
		},
	},
	{
		name: "browser_type",
		description: "Types text into a focused or referenced element. Supports template syntax (e.g. '${preferences.general.firstName}') which automatically resolves if preferences have been provided.",
		inputSchema: {
			type: "object",
			properties: {
				element: {
					type: "string",
					description: "Target element reference, CSS selector, or omit if already focused.",
				},
				text: {
					type: "string",
					description: "Text to type. Can include template variables such as '${preferences.general.fullName}'.",
				},
				clearValue: {
					type: "boolean",
					description: "Whether to clear existing field value before typing. Default: true.",
				},
				delay: {
					type: "number",
					description: "Delay between keystrokes in milliseconds (simulates human typing). Default: 25ms.",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
			required: ["text"],
		},
	},
	{
		name: "browser_press_key",
		description: "Dispatches a keyboard event (key press or key combination) to the active element. Examples: 'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown'.",
		inputSchema: {
			type: "object",
			properties: {
				key: {
					type: "string",
					description: "Key name (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Backspace').",
				},
				modifiers: {
					type: "array",
					items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] },
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
			required: ["key"],
		},
	},
	{
		name: "browser_select_option",
		description: "Selects one or more options in a standard HTML <select> dropdown by value, label, or index.",
		inputSchema: {
			type: "object",
			properties: {
				element: { type: "string", description: "Element reference of the <select> tag." },
				values: {
					type: "array",
					items: { type: "string" },
					description: "Array of option values or visible text labels to select.",
				},
				tabId: { type: "integer", description: "Target tab ID." },
			},
			required: ["element", "values"],
		},
	},
	{
		name: "browser_drag",
		description: "Drags from a source element/coordinate and drops onto a target destination.",
		inputSchema: {
			type: "object",
			properties: {
				startElement: { type: "string" },
				endElement: { type: "string" },
				startCoordinates: {
					type: "object",
					properties: { x: { type: "number" }, y: { type: "number" } },
				},
				endCoordinates: {
					type: "object",
					properties: { x: { type: "number" }, y: { type: "number" } },
				},
				tabId: { type: "integer" },
			},
		},
	},
	{
		name: "browser_wait",
		description: "Pauses execution for a specified duration in seconds (human pacing, awaiting DOM animations or async validation).",
		inputSchema: {
			type: "object",
			properties: {
				time: {
					type: "number",
					description: "Duration in seconds (e.g. 0.25 for 250ms, max 300).",
				},
			},
			required: ["time"],
		},
	},

	// --- Specialized Form & File Handling ---
	{
		name: "form_input",
		description: "Directly sets values in standard or custom form elements (text, select, checkbox, radio, date, number, textarea) with proper event firing (input, change, blur).",
		inputSchema: {
			type: "object",
			properties: {
				ref: {
					type: "string",
					description: "Element reference ID (e.g. 'ref_1', '@e12').",
				},
				value: {
					description: "Value to set (string, number, boolean for checkbox). Supports '${preferences.*}' templates.",
					anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array" }, { type: "object" }],
				},
				tabId: { type: "integer" },
			},
			required: ["ref", "value"],
		},
	},
	{
		name: "file_upload",
		description:
			'Directly injects files into <input type="file"> elements without opening native file picker dialogues. Can reference files uploaded to the extension or registered via store_file, or supply inline base64.',
		inputSchema: {
			type: "object",
			properties: {
				ref: {
					type: "string",
					description: "Element reference of the file input element.",
				},
				fileName: {
					type: "string",
					description: "Name of the file in storage (e.g. 'Resume.pdf').",
				},
				files: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							data: { type: "string", description: "Base64 encoded content." },
							mimeType: { type: "string" },
						},
						required: ["name"],
					},
					description: "Optional array of inline file data objects.",
				},
				tabId: { type: "integer" },
			},
			required: ["ref"],
		},
	},

	// --- Compound Batch Execution ---
	{
		name: "browser_batch",
		description: "Executes an atomic sequence of browser actions in a single turn with intermediate snapshot suppression, fail-fast error isolation, and unified diagnostic summary.",
		inputSchema: {
			type: "object",
			properties: {
				actions: {
					type: "array",
					items: {
						type: "object",
						properties: {
							tool: { type: "string", description: "Name of the sub-tool to execute (e.g. 'browser_hover', 'browser_click', 'browser_type', 'browser_wait')." },
							params: { type: "object", description: "Tool arguments." },
						},
						required: ["tool", "params"],
					},
					description: "Ordered array of tool calls to execute.",
				},
				stopOnError: {
					type: "boolean",
					description: "Whether to abort subsequent steps if any sub-action fails. Default: true.",
				},
				tabId: { type: "integer" },
			},
			required: ["actions"],
		},
	},

	// --- Tab & Window Management ---
	{
		name: "tabs_context",
		description: "Lists all browser tabs within the active window, showing tab IDs, titles, URLs, and active states.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "tabs_context_mcp",
		description: "Retrieves all tabs assigned to the agent's dedicated 'AutoResume (MCP)' tab group. Can create a tab group if none exists.",
		inputSchema: {
			type: "object",
			properties: {
				createIfEmpty: {
					type: "boolean",
					description: "Create a new tab group if no MCP tab group is currently active. Default: true.",
				},
			},
		},
	},
	{
		name: "tabs_create",
		description: "Creates a new browser tab within the 'AutoResume (MCP)' group and returns its tabId.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Initial URL. Default: 'chrome://newtab'." },
			},
		},
	},
	{
		name: "tabs_close",
		description: "Closes a tab belonging to the MCP tab group.",
		inputSchema: {
			type: "object",
			properties: {
				tabId: { type: "integer", description: "Tab ID to close." },
			},
			required: ["tabId"],
		},
	},
	{
		name: "tabs_target",
		description: "Targets and locks a browser tab into the AutoResume MCP group, attaching DevTools Protocol for trusted hardware simulation.",
		inputSchema: {
			type: "object",
			properties: {
				tabId: { type: "integer", description: "Tab ID to target. If omitted, targets currently active tab." },
			},
		},
	},
	{
		name: "tabs_untarget",
		description: "Removes a tab from the AutoResume MCP group and detaches DevTools Protocol.",
		inputSchema: {
			type: "object",
			properties: {
				tabId: { type: "integer", description: "Tab ID to untarget. If omitted, untargets active MCP tab." },
			},
		},
	},

	// --- Developer Inspection & Execution ---
	{
		name: "browser_get_console_logs",
		description: "Retrieves recorded browser console messages, errors, warnings, and unhandled exceptions.",
		inputSchema: {
			type: "object",
			properties: {
				onlyErrors: { type: "boolean", description: "Filter for errors only. Default: false." },
				limit: { type: "integer", description: "Maximum messages to return. Default: 100." },
				tabId: { type: "integer" },
			},
		},
	},
	{
		name: "browser_get_network_requests",
		description: "Inspects HTTP network requests (XHR, fetch, documents) captured on the active tab.",
		inputSchema: {
			type: "object",
			properties: {
				urlPattern: { type: "string", description: "Regex or substring pattern to filter URLs." },
				limit: { type: "integer", description: "Default: 100." },
				tabId: { type: "integer" },
			},
		},
	},
	//   {
	//     name: "javascript_exec",
	//     description: "Executes JavaScript in the page REPL context with await support, returning serialized results up to 50 KB with sensitive credentials redacted.",
	//     inputSchema: {
	//       type: "object",
	//       properties: {
	//         text: { type: "string", description: "JavaScript code string to evaluate." },
	//         tabId: { type: "integer" }
	//       },
	//       required: ["text"]
	//     }
	//   },

	// --- Tool Introspection & Schema Helper ---
	{
		name: "get_tool_definitions",
		description:
			"Returns the complete catalog of all AutoResume MCP tools, their input schemas, parameters, and descriptions in a single call. Use this instead of reading individual schema JSON files from disk.",
		inputSchema: {
			type: "object",
			properties: {
				toolName: {
					type: "string",
					description: "Optional specific tool name to inspect (e.g. 'form_input', 'browser_batch'). If omitted, returns all tools.",
				},
			},
		},
	},

	// --- Preference & File Management Tools (Dynamic / Not Preloaded) ---
	{
		name: "set_preferences",
		description:
			"Initializes or updates applicant preferences. The AI agent must call this after processing the user's resume, or when the user provides preference data. Automatically validates against preferences.schema.json and activates template substitutions.",
		inputSchema: {
			type: "object",
			properties: {
				preferences: {
					type: "object",
					description: "Full preferences object complying with preferences.schema.json.",
				},
				source: {
					type: "string",
					description: "Origin source (e.g. 'agent_parsed_resume', 'user_upload').",
				},
			},
			required: ["preferences"],
		},
	},
	{
		name: "validate_preferences_schema",
		description:
			"Validates a preferences object or specific section against the official preferences schema. Can validate custom preferences payload passed in arguments or currently active preferences.",
		inputSchema: {
			type: "object",
			properties: {
				section: {
					type: "string",
					enum: ["general", "education", "awards", "experience", "projects", "skills", "demographicsAndLegal", "customQA"],
					description: "Specific section to validate. If omitted, validates the entire document.",
				},
				preferences: {
					type: "object",
					description: "Optional custom preferences payload to test against the schema.",
				},
			},
		},
	},
	{
		name: "update_preferences_section",
		description: "Updates or merges new user-provided data into a section of the active preferences.",
		inputSchema: {
			type: "object",
			properties: {
				section: {
					type: "string",
					enum: ["general", "education", "awards", "experience", "projects", "skills", "demographicsAndLegal", "customQA"],
					description: "Target section name.",
				},
				data: {
					description: "Data object, array, or value to merge or store.",
					anyOf: [{ type: "object" }, { type: "array" }, { type: "string" }, { type: "number" }, { type: "boolean" }],
				},
				overwrite: {
					type: "boolean",
					description: "Whether to replace the section rather than merge. Default: false.",
				},
			},
			required: ["section", "data"],
		},
	},
	{
		name: "get_preferences",
		description: "Retrieves applicant preference data from active preferences by property path or returns the entire object. Returns an error if preferences have not yet been provided.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Dot/bracket notation path (e.g. 'general.phone.formatted', 'education[0]', 'customQA').",
				},
			},
		},
	},
	{
		name: "store_file",
		description: "Stores or registers a file (e.g. resume PDF or Markdown) in session storage so it can be injected into web forms via the file_upload tool.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Filename (e.g. 'Resume.pdf' or 'Resume.md')." },
				data: { type: "string", description: "Base64 encoded file content." },
				mimeType: { type: "string", description: "MIME type (e.g. 'application/pdf')." },
				description: { type: "string", description: "Brief description of file contents." },
			},
			required: ["name"],
		},
	},
	{
		name: "list_files",
		description: "Lists all files currently uploaded or registered in session storage.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "read_file",
		description:
			"Reads the content of an uploaded or stored file (e.g. resume PDF or Markdown). For text, Markdown, or JSON files, returns the decoded UTF-8 string text. For binary/PDF files, returns base64 and text extracts.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Name of the file to inspect (e.g. 'Resume.pdf' or 'Resume.md')." },
			},
			required: ["name"],
		},
	},
	{
		name: "delete_file",
		description: "Deletes an uploaded or registered file from session storage and notifies the extension.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Name of the file to delete (e.g. 'Resume.pdf')." },
			},
			required: ["name"],
		},
	},
];

export const TOOLS_BY_NAME = new Map(TOOL_CATALOG.map((tool) => [tool.name, tool]));
