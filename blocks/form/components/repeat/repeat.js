import { getId } from '../../util.js';
import { subscribe } from '../../rules/index.js';

/**
 * Updates radio button names to ensure proper grouping within repeatable instances.
 * Radio buttons in the same instance share the same name,
 * but different instances have different group names.
 * @param {HTMLElement} instance - The repeatable instance element
 * @param {number} index - The index of the instance
 */
function updateRadioButtonNames(instance, index) {
  // Only update if this is actually a repeatable instance
  if (!instance.dataset.repeatable || instance.dataset.repeatable !== 'true') {
    return;
  }

  instance.querySelectorAll('input[type="radio"]').forEach((radio) => {
    const baseName = radio.name.replace(/-\d+$/, '');
    const expectedName = index > 0 ? `${baseName}-${index}` : baseName;

    if (radio.name !== expectedName) {
      radio.name = expectedName;
    }
  });
}

/**
 * Updates a fieldset instance with proper IDs, labels, and radio button names.
 * @param {HTMLElement} fieldset - The fieldset element to update
 * @param {number} index - The index of the instance
 * @param {string} labelTemplate - Template for the label text (uses '#' as placeholder)
 */
function update(fieldset, index, labelTemplate) {
  const legend = fieldset.querySelector(':scope>.field-label')?.firstChild;
  const text = labelTemplate?.replace('#', index + 1);
  if (legend) {
    legend.textContent = text;
  }
  if (typeof fieldset.id === 'undefined') {
    fieldset.id = getId(fieldset.name);
  }
  fieldset.setAttribute('data-index', index);
  if (index > 0) {
    fieldset.querySelectorAll('.field-wrapper').forEach((f) => {
      const [label, input, description] = ['label', 'input,select,button,textarea', 'description']
        .map((x) => f.querySelector(x));
      if (input) {
        input.id = getId(input.name);
      }
      if (label) {
        label.htmlFor = input.id;
      }
      if (description) {
        input.setAttribute('aria-describedby', `${input.Id}-description`);
        description.id = `${input.id}-description`;
      }
    });
  }

  updateRadioButtonNames(fieldset, index);
}

/**
 * Creates a button element with specified label and icon class.
 * @param {string} label - The button text
 * @param {string} icon - The icon class name (add/remove)
 * @returns {HTMLButtonElement} The created button element
 */
function createButton(label, icon) {
  const button = document.createElement('button');
  button.className = `item-${icon}`;
  button.type = 'button';
  const text = document.createElement('span');
  text.textContent = label;
  button.append(document.createElement('i'), text);
  return button;
}

/**
 * Updates the visibility of add/remove buttons based on min/max constraints.
 * @param {HTMLElement} wrapper - The repeat wrapper element
 */
function updateButtonVisibility(wrapper) {
  const instances = wrapper.querySelectorAll('[data-repeatable="true"]');
  const count = instances.length;
  const min = parseInt(wrapper.dataset.min || 0, 10);
  const max = parseInt(wrapper.dataset.max || -1, 10);

  const addButton = wrapper.querySelector('.item-add');
  if (addButton) {
    if (max !== -1 && count >= max) {
      addButton.style.display = 'none';
    } else {
      addButton.style.display = '';
    }
  }

  const removeButtons = wrapper.querySelectorAll('.item-remove');
  removeButtons.forEach((btn) => {
    btn.style.display = count <= min ? 'none' : '';
  });
}

/**
 * Gets all sibling instances of a repeatable element.
 * @param {HTMLElement} el - The starting element
 * @returns {HTMLElement[]} Array of sibling instances
 */
function getInstances(el) {
  let nextSibling = el.nextElementSibling;
  const siblings = [el];
  while (nextSibling && nextSibling.matches('[data-repeatable="true"]:not([data-repeatable="0"])')) {
    siblings.push(nextSibling);
    nextSibling = nextSibling.nextElementSibling;
  }
  return siblings;
}

/**
 * Strategy pattern for handling different form types (AF based and document based)
 */
const repeatStrategies = {
  af: {
    /**
     * Adds a new instance using the Adaptive Forms model.
     * @param {HTMLElement} wrapper - The repeat wrapper element
     */
    addInstance: (wrapper) => {
      if (wrapper.fieldModel) {
        const action = { type: 'addInstance', payload: wrapper.fieldModel.items?.length || 0 };
        wrapper.fieldModel.addItem(action);
      }
    },

    /**
     * Removes an instance using the Adaptive Forms model.
     * @param {HTMLElement} wrapper - The repeat wrapper element
     * @param {number} instanceIndex - The index of the instance to remove
     */
    removeInstance: (wrapper, instanceIndex) => {
      if (wrapper.fieldModel) {
        const action = { type: 'removeInstance', payload: instanceIndex };
        wrapper.fieldModel.removeItem(action);
      }
    },

    /**
     * Sets up model subscription for Adaptive Forms to handle dynamic instance changes.
     * @param {HTMLElement} wrapper - The repeat wrapper element
     * @param {HTMLElement} form - The form element
     * @param {string} formId - The form ID
     */
    setup: (wrapper, form, formId) => {
      const containerElement = wrapper.closest('fieldset[data-id]');

      subscribe(containerElement, formId, (fieldDiv, fieldModel) => {
        wrapper.fieldModel = fieldModel;
        fieldModel.subscribe((e) => {
          const { payload } = e;
          payload?.changes?.forEach((change) => {
            if (change?.propertyName === 'items') {
              // eslint-disable-next-line max-len
              // Reason for requestAnimationFrame: Model changes fire immediately but
              // DOM updates are async.
              // We need to wait for the browser's next paint cycle
              // to ensure the new/removed fieldsets
              // are in the DOM before adding/updating buttons.
              requestAnimationFrame(() => {
                wrapper.querySelectorAll('[data-repeatable="true"]').forEach((instance, index) => {
                  updateRadioButtonNames(instance, index);
                });
                // eslint-disable-next-line no-use-before-define
                addRemoveButtons(wrapper, form, false);
                updateButtonVisibility(wrapper);
              });
            }
          });
        }, 'change');
      });
    },
  },

  doc: {
    /**
     * Adds a new instance using direct DOM manipulation (document-based forms).
     * @param {HTMLElement} wrapper - The repeat wrapper element
     * @param {HTMLElement} form - The form element
     */
    addInstance: (wrapper, form) => {
      const fieldset = wrapper['#repeat-template'];
      const childCount = wrapper.children.length - 1;
      const newFieldset = fieldset.cloneNode(true);
      newFieldset.setAttribute('data-index', childCount);
      update(newFieldset, childCount, wrapper['#repeat-template-label']);

      const actions = wrapper.querySelector('.repeat-actions');
      actions.insertAdjacentElement('beforebegin', newFieldset);

      // Add remove button to the new instance
      // eslint-disable-next-line no-use-before-define
      insertRemoveButton(newFieldset, wrapper, form, true);

      // Add remove buttons to all existing instances that don't have them
      // (this handles the case where we started with min instances and no buttons)
      // eslint-disable-next-line no-use-before-define
      addRemoveButtons(wrapper, form, true);

      updateButtonVisibility(wrapper);

      const event = new CustomEvent('item:add', {
        detail: { item: { name: newFieldset.name, id: newFieldset.id } },
        bubbles: false,
      });
      form.dispatchEvent(event);
    },

    /**
     * Removes an instance using direct DOM manipulation (document-based forms).
     * @param {HTMLElement} fieldset - The fieldset to remove
     * @param {HTMLElement} wrapper - The repeat wrapper element
     * @param {HTMLElement} form - The form element
     */
    removeInstance: (fieldset, wrapper) => {
      fieldset.remove();
      wrapper.querySelectorAll('[data-repeatable="true"]').forEach((el, index) => {
        update(el, index, wrapper['#repeat-template-label']);
      });
      updateButtonVisibility(wrapper);
    },

    /**
     * No setup needed for document-based forms.
     */
    setup: () => {
      // No setup required for doc-based forms
    },
  },
};

/**
 * Inserts a remove button into a fieldset instance.
 * @param {HTMLElement} fieldset - The fieldset to add the button to
 * @param {HTMLElement} wrapper - The repeat wrapper element
 * @param {HTMLElement} form - The form element
 * @param {boolean} isDocBased - Whether this is a document-based form
 */
function insertRemoveButton(fieldset, wrapper, form, isDocBased = false) {
  const label = wrapper.dataset?.repeatDeleteButtonLabel || fieldset.dataset?.repeatDeleteButtonLabel || 'Delete';
  const removeButton = createButton(label, 'remove');

  removeButton.addEventListener('click', () => {
    const repeatWrapper = fieldset.closest('.repeat-wrapper');
    const allInstances = repeatWrapper.querySelectorAll('[data-repeatable="true"]');
    const currentIndex = Array.from(allInstances).indexOf(fieldset);

    const repeatHandler = repeatStrategies[isDocBased ? 'doc' : 'af'];
    if (isDocBased) {
      repeatHandler.removeInstance(fieldset, wrapper, form);
    } else {
      repeatHandler.removeInstance(wrapper, currentIndex);
    }
  });

  fieldset.append(removeButton);
}

/**
 * Adds remove buttons to instances that don't already have them.
 * @param {HTMLElement} wrapper - The repeat wrapper element
 * @param {HTMLElement} form - The form element
 * @param {boolean} isDocBased - Whether this is a document-based form
 */
function addRemoveButtons(wrapper, form, isDocBased = false) {
  const instances = wrapper.querySelectorAll('[data-repeatable="true"]');

  instances.forEach((instance) => {
    const existingRemoveButton = instance.querySelector('.item-remove');
    if (existingRemoveButton) {
      return; // Skip instances that already have remove buttons
    }

    insertRemoveButton(instance, wrapper, form, isDocBased);
  });
}

/**
 * Adds a new instance using the appropriate strategy.
 * @param {HTMLElement} wrapper - The repeat wrapper element
 * @param {HTMLElement} form - The form element
 * @param {boolean} isDocBased - Whether this is a document-based form
 */
function addInstance(wrapper, form, isDocBased = false) {
  const repeatHandler = repeatStrategies[isDocBased ? 'doc' : 'af'];
  repeatHandler.addInstance(wrapper, form);
}

/**
 * Inserts an add button into the repeat wrapper.
 * @param {HTMLElement} wrapper - The repeat wrapper element
 * @param {HTMLElement} form - The form element
 * @param {boolean} isDocBased - Whether this is a document-based form
 */
export function insertAddButton(wrapper, form, isDocBased = false) {
  const actions = document.createElement('div');
  actions.className = 'repeat-actions';
  const addLabel = wrapper?.dataset?.repeatAddButtonLabel || 'Add';
  const addButton = createButton(addLabel, 'add');
  addButton.addEventListener('click', () => {
    addInstance(wrapper, form, isDocBased);
  });
  actions.appendChild(addButton);
  wrapper.append(actions);
}

/**
 * Transforms repeatable DOM elements into a structured repeat wrapper
 * with add/remove functionality.
 * This is the main entry point for setting up repeatable form sections.
 * @param {HTMLElement} form - The form element
 * @param {Object} formDef - The form definition
 * @param {HTMLElement} container - The container element
 * @param {string} formId - The form ID
 */
export default function transferRepeatableDOM(form, formDef, container, formId) {
  form.querySelectorAll('[data-repeatable="true"][data-index="0"]').forEach((el) => {
    const instances = getInstances(el);
    const isDocBased = form.dataset.source !== 'aem';

    const wrapper = document.createElement('div');
    wrapper.dataset.min = el.dataset.min || 0;
    wrapper.dataset.max = el.dataset.max;
    wrapper.dataset.variant = el.dataset.variant || 'addDeleteButtons';
    wrapper.dataset.repeatAddButtonLabel = el.dataset?.repeatAddButtonLabel ? el.dataset.repeatAddButtonLabel : 'Add';
    wrapper.dataset.repeatDeleteButtonLabel = el.dataset?.repeatDeleteButtonLabel ? el.dataset.repeatDeleteButtonLabel : 'Delete';
    wrapper.className = 'repeat-wrapper';

    el.insertAdjacentElement('beforebegin', wrapper);
    wrapper.append(...instances);
    wrapper.querySelectorAll('.item-remove').forEach((element) => element.remove());
    wrapper.querySelectorAll('.repeat-actions').forEach((element) => element.remove());

    const cloneNode = el.cloneNode(true);
    cloneNode.removeAttribute('id');
    wrapper['#repeat-template'] = cloneNode;
    wrapper['#repeat-template-label'] = el.querySelector(':scope>.field-label')?.textContent;

    // Handle minimum instance removal
    if (+el.dataset.min === 0) {
      el.remove();
    } else {
      update(el, 0, wrapper['#repeat-template-label']);
      el.setAttribute('data-index', 0);
    }

    // Setup form-specific logic using strategy pattern
    const repeatHandler = repeatStrategies[isDocBased ? 'doc' : 'af'];
    repeatHandler.setup(wrapper, form, formId);

    // Update radio button names for both AEM and doc-based forms
    wrapper.querySelectorAll('[data-repeatable="true"]').forEach((instance, index) => {
      updateRadioButtonNames(instance, index);
    });

    // Add remove buttons only if there are more instances than minimum
    const min = parseInt(wrapper.dataset.min || 0, 10);
    if (instances.length > min) {
      addRemoveButtons(wrapper, form, isDocBased);
    }

    if (el.dataset.variant !== 'noButtons') {
      insertAddButton(wrapper, form, isDocBased);
    }

    updateButtonVisibility(wrapper);
  });
}

// Export functions for external use
export {
  insertRemoveButton, addInstance, updateButtonVisibility, createButton,
};
