/* this is a content script - it is attached to each opened webpage*/
(function() {
	var settings = {};	//last cahnge of all settings
	var readingStatus = null;
	
	var getTextToRead;	//either returns content of highlighted or browser-selected text
	var onArrow;	//called when arrows are pressed, parameters: keyEvent, direction
	var onClick;	//called when mouse is clicked
	var onSpace;	//called when space is pressed with parameter: keyEvent
	var onMouseMove;	//called when the mouse pinter moves
	var onEsc;	//called when esc key is pressed
	
	// ============================================= highlight =============================================	
	var clickedElement = null;	//TODO maybe some nicer logic
	
	//elements can be highlighted based on their status: highlighted|loading|playing|error
	var status2element = {};
	
	//element => {cakgroundColor,transition}
	var element2original = new Map();
	
	/** stores the current backgroundColor and tansition styles of given element */
	function saveOriginal(element) {
		if(element2original.get(element)) return;	//already saved
		element2original.set(element,{
			backgroundColor:element.style["background-color"]
			,transition:element.style["-webkit-transition"]
		});
	}
	
	/** @return concatenates statuses of given element with "-" in order highlighted-loading-playing-error */
	function concatenatedStatus(element) {
		return ["highlighted","loading","playing","error"].filter(function(status) {
			return status2element[status] === element;	//only inerested in statuses where element is given element
		}).join("-");
	}

	/** animates given element based on the status2element */
	function animate(element) {
		var status = concatenatedStatus(element);
		element.style["-webkit-transition"] = "background-color .2s ease-in-out";
		switch(status) {
			case("highlighted"): 		element.style["background-color"] = "#4f4"; break;
			case("highlighted-loading"):element.style["background-color"] = "#55f"; break;
			case("highlighted-playing"):element.style["background-color"] = "#55f"; break;
			case("highlighted-error"):element.style["background-color"] = "#f55"; break;
			case("loading"): 		element.style["background-color"] = "#bbf"; break;
			case("playing"):		element.style["background-color"] = "#bbf"; break;
			case("error"):			element.style["background-color"] = "#fbb"; break;
		}
	}
	
	/** adds @param status on @param element
	 * removes same status from other elements
	 * loading|playing|error are exclusive */
	function addStatus(element,status) {
		if(element && status2element[status] === element) return;	//all done
 
		//status is set on another element => revert first
		if(["loading","playing","error"].indexOf(status) > -1) {
			revert("loading");
			revert("playing");
			revert("error");
		} else revert(status);
 
		//if we removed status (added status to null) revert already set the original styles
		if(!element) return;
 
		status2element[status] = element;
		saveOriginal(element);
		animate(element);
	}
	
	/** reverts the highlighted element */
	function revert(status) {
		var element = status2element[status];
		if(!element) return;

		status2element[status] = null;	
		if(concatenatedStatus(element)) {
			//element still has some status, animate based on the new concatenated style
			animate(element);
			return;
		}
		
		var original = element2original.get(element);
		element.style["background-color"] = original.backgroundColor;
		window.setTimeout(function() {
			//if any style is set, we don't revert the the transition
			if(concatenatedStatus(element)) return;
			
			//otherwise we do, and also remove the original for given element
			element.style["-webkit-transition"] = original.transition;
			element2original.delete(element);
		}, 200);
	}
	
	function containsTextDirectly(element) {
		for(var i=0; i<element.childNodes.length; i++) {
			var child = element.childNodes[i];
			if(child.nodeType == Node.TEXT_NODE && /\S/.test(child.nodeValue)) return true;	//text node AND not empty
		}
		return false;
	}
	
	/** @return the text in highlighted element */
	function getHoveredParagraphText() {
		clickedElement = status2element.highlighted;
		if(clickedElement) return clickedElement.textContent;
		else return "";
	}
	
	// ============================================= highlighted element =============================================
	/** @return the hovered paragraph
	 * the top element that contains text directly
	 * there are elements inside a text in many cases (e.g. <i> in wikipedia articles)
	 * we want to select the whole paragraph even if this inside element is hovered*/
	function getHoveredParagraph() {
		var hoveredNodes = document.querySelectorAll(":hover");
		for(var i=0; i<hoveredNodes.length; i++) {
			var element = hoveredNodes[i];
			if(containsTextDirectly(element)) return element;
		}
		return null;
	}
	
	/** highlights the element under mouse pointer */
	function highlightHoveredElement() {
		if(isMouseMoveEventFromScrolling()) return true;	//TODO, here?
		var element = getHoveredParagraph();
		addStatus(element, "highlighted");
		setCursor();	//revert cursor
	}
	
	// ============================================= keyboard navigation =============================================
	
	/** when stepping between elements, the cursor defines the path we can take. It has a rect and a direction (horizontal|vertical)
	 * when moving up/down, all elements we step on are between the left and right side of cursor.rect (vertical path)
	 * when moving left/right, the current element will be the cursor, and the path will be between rect.top and rect.bottom (horizontal path)
	 * 
	 * this strategy showed the best results when comparying different concepts*/
	var cursor = {rect:null, direction:null}

	/** sets the cursor
	 * @param rect the rect of the currently highlighted element
	 * @param direction up|down|left|right
	 * if the direction of the cursor (horizontal|vertical) is different than the one defined by @param direction, cursor is reset*/
	function setCursor(rect, direction) {
		switch(direction) {
			case("up"):
			case("down"):
				if(cursor.direction != "vertical") {
					cursor.direction = "vertical";
					cursor.rect = rect;
				}
				break;
			case("left"):
			case("right"):
				if(cursor.direction != "horizontal") {
					cursor.direction = "horizontal";
					cursor.rect = rect;
				}
				break;
			default:	//to remove the cursor
				cursor.direction = null;
				cursor.rect = null;
		}
	}
	
	/** @return true if rect is on the path selected by the cursor. assuming the cursor is set*/
	function isOnPath(rect) {
		//filter based on cursor
		switch(cursor.direction) {
			case("vertical"):
				//equality: in case of tables, the top of underlying row is the same as bottom
				if(rect.right <= cursor.rect.left) return false;
				if(cursor.rect.right <= rect.left) return false;
				break;
			case("horizontal"):
				if(cursor.rect.bottom <= rect.top) return false;
				if(rect.bottom <= cursor.rect.top) return false;
				break;
		}
		return true;
	}
	
	/** @return distance between rect1 and rect2 in given direction
	 * result my be negative in case rect2 is "behind" rect1 based on direction */
	function dist(rect1,rect2,direction) {
		var m1 = {x:(rect1.left + rect1.right)/2, y:(rect1.top + rect1.bottom)/2};
		var m2 = {x:(rect2.left + rect2.right)/2, y:(rect2.top + rect2.bottom)/2};
		
		//get the distance in given direction
		switch(direction) {
			case("up"): return m1.y - m2.y;
			case("down"): return m2.y - m1.y;
			case("left"): return m1.x - m2.x;
			case("right"): return m2.x - m1.x;
		}
	}
	
	var closest = {element:null,dist:-1,rect:null};
	
	/** sets closest
	 * @param fromRect the rect to which the closest is searched
	 * @param element the element we currently check
	 * @param direction up|down|left|right the direction of search
	 * @parant */
	function setClosest(fromRect, element, direction) {
		if(!element) return;
		if(!element.getBoundingClientRect) return; //no getBoundingClientRect: no content
		
		//contains text directly => check if position is fine
		if(containsTextDirectly(element)) {
			var rect = element.getBoundingClientRect();
			if(!isOnPath(rect)) return;
			if(element === status2element.highlighted) return;
			var d = dist(fromRect,rect,direction);
			if(d <= 0) return;
			if((closest.dist > -1) && (closest.dist < d)) return;
			closest.element = element;
			closest.dist = d;
			closest.rect = rect;
			return;
		}
		
		//doesn't contain text directly => explore its children
		for(var i=0; i<element.childNodes.length; i++) {
			var child = element.childNodes[i];
			setClosest(fromRect, child, direction);
		}
	}
	
	var lastScroll = 0;	//time of last scrolling caused by stepping (to prevent unnecessary onMouseMove event)
	
	/** highlights element in @param direction from currently highlighted element */
	function stepHighlight(keyEvent, direction) {
		keyEvent.stopPropagation();	//other event listeners won't execute
		keyEvent.preventDefault();	//stop scrolling

		var fromRect;
		if(status2element.highlighted) fromRect = status2element.highlighted.getBoundingClientRect();
		else fromRect = document.documentElement.getBoundingClientRect();
		setCursor(fromRect,direction);
		
		closest = {element:null,dist:-1,rect:null};
		setClosest(fromRect, document.documentElement, direction);

		if(!closest.element) return;
		addStatus(closest.element,"highlighted");
		chrome.runtime.sendMessage({action: "stepHighlight"}, null);
		
		//scroll into view
		var scroll = {x:0,y:0};
		switch(direction) {
			case("up"): if(closest.rect.top < 0) scroll.y = closest.rect.top; break;
			case("down"): if(closest.rect.bottom > window.innerHeight) scroll.y = closest.rect.bottom-window.innerHeight; break;
			case("left"): if(closest.rect.left < 0) scroll.x = closest.rect.left; break;
			case("right"): if(closest.rect.right > window.innerWidth) scroll.x = closest.rect.right-window.innerRight; break;
		}
		if(scroll.x || scroll.y) {
			window.scrollBy(scroll.x, scroll.y);
			lastScroll = Date.now();
		}
		//createDivOnBoundingClientRect(closest.rect);
	}
	
	function isMouseMoveEventFromScrolling() {
		return (Date.now() - lastScroll) < 500;	//the usual value is around 100ms
	}
	
	//TODO remove this, only here for debugging
	var div = null;
	function createDivOnBoundingClientRect(rect) {
		if(div) {
			div.parentElement.removeChild(div);
		}
		
		div = document.createElement("div");
		div.style.position = "absolute";
		div.style.left = rect.left + window.scrollX + "px";
		div.style.top = rect.top + window.scrollY + "px";
		div.style.width = rect.right - rect.left + "px";
		div.style.height = rect.bottom - rect.top + "px";
		div.style.backgroundColor = "rgba(0,0,255,0.5)";
		div.id = "highlightId";
		document.documentElement.appendChild(div);
	}
	
	// ============================================= animate clicked =============================================
	
	function animateClicked(readingEvent) {
		switch(readingEvent) {
			case("loading"):
				readingStatus = "loading";
				addStatus(clickedElement,"loading");
				break;
			case("start"):
				readingStatus = "playing";
				addStatus(clickedElement,"playing");
				break;
			case("end"):
				readingStatus = null;
				addStatus(null,"playing");	//reverts loading, playing, error
				break;
			case("error"):
				readingStatus = "error";
				addStatus(clickedElement,"error");
				break;
		}
	}

	// ============================================= browser select =============================================
	/** reads the selected area*/
	function getBrowserSelectedText() {
		return getSelection().toString();
	}
	
	// ============================================= read =============================================
	
	/** reads the text to be read (highlighted paragraph / selected text) */
	function readText() {
		chrome.runtime.sendMessage({
			action: "read"
			,text: getTextToRead()	//should never reach this point if getTextToRead is null
			,lan: document.documentElement.lang
		});
	}
	
	/** should be called with the "keydown" event when space is pressed
	 * reads text provided by getText(), and stops page scroll if the active element is an input*/
	function readTextAndPreventScroll(event) {
		readText();
		event.preventDefault();	//stop scrolling
	}
	
	// ============================================= general =============================================
	
	/** if value is true, sets callbacks based on the settings
	 * if false, sets callbacks to null */
	function setTurnedOn(value) {
		if(value) {
			updateSetting({setting:"selectType", value:settings.selectType});
			updateSetting({setting:"highlightOnHover", value:settings.highlightOnHover});
			updateSetting({setting:"highlightOnArrows", value:settings.highlightOnArrows});
			updateSetting({setting:"readOnClick", value:settings.readOnClick});
			updateSetting({setting:"readOnSpace", value:settings.readOnSpace});
		} else {
			onClick = null;
			onSpace = null;
			onMouseMove = null;
			onArrow = null;
			revert("highlighted");
		}
	}
	
	/** selecttype is highlightSelect => sets the callbacks regarding highlight
	 * otherwise => turns off highlight related callbacks, and sets getTextToRead to read browser selected text*/
	function setSelectType(value) {
		//highlightSelect
		if(settings.turnedOn && value == "highlightSelect") {
			getTextToRead = getHoveredParagraphText;
			onMouseMove = settings.highlightOnHover?highlightHoveredElement:null;
			onArrow = settings.highlightOnArrows?stepHighlight:null;
			return;
		}
		
		//builtInSelect
		if(settings.turnedOn && value == "builtInSelect") {
			getTextToRead = getBrowserSelectedText;
			onMouseMove = null;
			onArrow = null;
			revert("highlighted");
			return;
		}
		
		//off
		getTextToRead = null;
		onMouseMove = null;
		onArrow = null;
		revert("highlighted");
		//stop event => other states are reverted
	}
	
	/** sets the onMouseMove callback if criterias match: value, turnedOn, selectType
	 * nulls it othwerwise */
	function setHighlightOnHover(value) {
		if(value && settings.turnedOn && settings.selectType == "highlightSelect") onMouseMove = highlightHoveredElement;
		else {
			onMouseMove = null;
			if(!settings.highlightOnArrows) revert("highlighted");
		}
	}
	
	/** onArrow callback if criterias match: value, turnedOn, selectType
	 * nulls it othwerwise */
	function setHighlightOnArrows(value) {
		if(value && settings.turnedOn && settings.selectType == "highlightSelect") onArrow = stepHighlight;
		else {
			onArrow = null;
			if(!settings.highlightOnHover) revert("highlighted");
		}
	}
	
	/** sets onClick based on criterias: value, turnedOn */
	function setOnClick(value) {
		if(value && settings.turnedOn) onClick = readText;
		else onClick = null;
	}
	
	/** sets onSpace based on criterias: value, turnedOn */
	function setSpace(value) {
		if(value && settings.turnedOn) onSpace = readTextAndPreventScroll;
		else onSpace = null;
	}
	
	function updateSetting(request) {
		settings[request.setting] = request.value;
		switch(request.setting) {
			case("turnedOn"):			setTurnedOn(request.value);			break;
			case("selectType"):			setSelectType(request.value);		break;
			case("highlightOnHover"):	setHighlightOnHover(request.value);	break;
			case("highlightOnArrows"):	setHighlightOnArrows(request.value);break;
			case("readOnClick"):		setOnClick(request.value);			break;
			case("readOnSpace"):		setSpace(request.value);			break;
		}
	}
	
	function onMessage(request, sender, sendResponse) {
		switch(request.action) {
			case("event"): animateClicked(request.event); break;
			case("set"): updateSetting(request); break;
		}
	}
	/** to react when setting is changed in options*/
	chrome.runtime.onMessage.addListener(onMessage);
	
	onEsc = function(keyEvent) {
		if(!readingStatus == "playing") return;
		
		//if reading => stop + stop event propagation
		chrome.runtime.sendMessage({action: "read",text:""});
		keyEvent.stopPropagation();	//other event listeners won't execute
	}
	
	window.addEventListener("mousemove", function(event) {
		if(onMouseMove) onMouseMove();
	});
	window.addEventListener("mousedown", function(event) {
		if(onClick) onClick();
	});
	window.addEventListener("keydown", function(event) {
		var activeTagName = document.activeElement?document.activeElement.tagName:null;
		if(["INPUT","TEXTAREA"].indexOf(activeTagName) > -1) {
			return;	//if an input field has focus, we ignore PressToSpeech controls TODO feedback
		}
		
		switch(event.keyCode) {
			case(32): if(onSpace) onSpace(event);			break;
			case(37): if(onArrow) onArrow(event, "left");	break;
			case(38): if(onArrow) onArrow(event, "up");		break;
			case(39): if(onArrow) onArrow(event, "right");	break;
			case(40): if(onArrow) onArrow(event, "down");	break;
			case(27): if(onEsc) onEsc(event); break;
		}
	}, true);
	//last parameter: useCapture. True to have better changes that this listener executes first - so it can stop event propagation
	//http://stackoverflow.com/questions/7398290/unable-to-understand-usecapture-attribute-in-addeventlistener
	
	//initial setup
	chrome.runtime.sendMessage({action: "getSettings"}, function(settings) {
		updateSetting({setting:"turnedOn", value:settings.selectType});
		updateSetting({setting:"selectType", value:settings.selectType});
		updateSetting({setting:"highlightOnHover", value:settings.highlightOnHover});
		updateSetting({setting:"highlightOnArrows", value:settings.highlightOnArrows});
		updateSetting({setting:"readOnClick", value:settings.readOnClick});
		updateSetting({setting:"readOnSpace", value:settings.readOnSpace});
	});
})();
