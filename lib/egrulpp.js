'use strict';

var EGRUL_PDF_SCHEMA = require('./egrulpp.schema');
var fs = require('fs');
var vow = require('vow');
var spawn = require('child_process').spawn;

/**
 * Normalize string for the RegExp (escapes spec symbols)
 *
 * @param {string} src - source string
 * @param {boolean} start_line - start line flag
 * @returns {object} RegExp - String converted to RegExp with escaped spec symbols  
 */
var normalize_re = function(src, start_line) {
	return new RegExp((start_line ? '^' : '') +
		src
		.replace('.', '\\.')
		.replace('(', '\\(')
		.replace(')', '\\)')
		.replace(',', '\\,')
		.replace('-', '\\-')
	);
}

/**
 * Retreives first and last line index of the section name
 *
 * @param {Array} src - source lines array
 * @param {string} dst_name - destination section name string 
 * @returns {Array} indx - section name limits or 'undefined' if can't find it
 * @returns {Array} indx[0] - first line index of the section name
 * @returns {Array} indx[1] - last line index of the section name  
 */
var get_sect_indx = function(src, dst_name) {
	var chunk = {
		name: '',
		indx: undefined
	};
	
	for (var i = 0; i < src.length; i++) {
		
		// if in the first section line searching now
		if ('' === chunk.name) {
			// if this line contents first line substring of section name
			if( normalize_re(src[i], true).test(dst_name) ) {
	
				chunk.name = src[i];
				chunk.indx = i;
				// if line substring is equal to section name
				if (chunk.name === dst_name)
					return [chunk.indx, i];
			}
		
		// if first section line is detected
		} else {
			// if line contents substring of section name
			if( normalize_re(src[i], false).test(dst_name) ) {
				chunk.name += ' ' +  src[i];
			
				// if line substring is equal to section name
				if (chunk.name === dst_name)
					return [chunk.indx, i];

			} else {
				return undefined;
			}
		}
	}
	return undefined;
}

/**
 * Retreives the value of the subsection item
 *
 * @param {Array} src - source subsection lines array
 * @param {string} sign - searched sign of the section name 
 * @returns {string} value - subsection value if exist, otherwise - 'undefined'
 */
var parse_items = function(src, sign) {

	//sign_consistent = false
	var item = {
		sign: {
			val: '',
			is_consistent: false
		},
		val: ''
	}

	src.some(function(line){

		// item's first line sign
		var sign_match = /^\d{1,2}\s+(\W+[^\s])\s{2,}/g.exec(line);
			
		// if in the first section line searching now
		if ('' === item.sign.val) {
			
			// if this line contents first line substring of item's name
			if (sign_match && normalize_re(sign_match[1], true).test(sign)) {
				var val_match = /^\d{1,2}\s+\W+[^\s]\s{2,}(.+)/g.exec(line);
				
				item.sign.val = sign_match[1];
				if (val_match[1] !== null)
					item.val = val_match[1];
				
				// if line substring is equal to item's sign
				if (item.sign.val === sign)
					item.sign.is_consistent = true;
			}
		
		// if first section line is detected and next item reached
		} else if (sign_match) {
			return true;

		// if first section line is detected and the item filling continue now
		} else {
			
			// if the sign is consistent
			if (item.sign.is_consistent) {
			
				item.val += ' ' + line.replace(/^\s+|\s+$/gm,'');
			
			// if the sign is not consistent now
			} else {
				var l_s = line
					// splitting by the ranges, consisting of not less than two spaces
					.split(/(\s{2,})/g)
					// filtering empty strings and strings consisting from spaces only
					.filter(function(i){return i !== '' && !(/(^\s+$)/g.test(i))})
					// trimming the leading and the trailng spaces
					.map(function(i){return i.replace(/^\s+|\s+$/gm,'')});

				item.sign.val += ' ' + l_s[0];
				if (2 === l_s.length)
					item.val += ' ' + l_s[1];
				
				// if line substring is equal to item's sign
				if (item.sign.val === sign)
					item.sign.is_consistent = true;
			}
		}
		return false;

	});

	return item.sign.is_consistent ? item.val : undefined;
}

/**
 * Retreives the EGRUL data
 *
 * @param {Array} src - source trimmed lines array
 * @param {object} skel - skeleton
 * @returns {object} data - EGRUL data object if exist, otherwise - 'undefined'
 */
var parse_sects = function(src, skel) {
	var _src = src.slice()
	var cur_key = undefined;
	var cur_item_signs = undefined;
	var egrul = {};
	
	skel.forEach(function(s){
		var range = get_sect_indx(_src, s.id);

		if (range !== undefined) {
			var s_items = _src.splice(0, range[1]).splice(0, range[0]);
			if (cur_key !== undefined){
				cur_item_signs.forEach(function(f){
					var v = parse_items(s_items, f.id);
					if (v !== undefined)
						egrul[cur_key][f.key] = v;
				});
			}

			cur_key = s.key;
			cur_item_signs = s.data;

			if (cur_key !== undefined)
				egrul[cur_key] = {};
		}
	});

	return egrul;
}

/**
 * Retreives the entity skel and type
 *
 * @param {Array} src - source lines array
 * @returns {Array} data - entity skel and type
 * @returns {object} data[0] - entity skel
 * @returns {string} data[1] - entity type: 'LE', 'IP' or 'KFH'
 */
var get_entity_type = function(src) {

	switch(src[0]) {
		case EGRUL_PDF_SCHEMA.SIGN_ENTITY_TYPE.LE:
		{
			return [EGRUL_PDF_SCHEMA.SCHEMA.LE, 'LE'];
		}
		case EGRUL_PDF_SCHEMA.SIGN_ENTITY_TYPE.SE:
		{
			switch(src[1]) {
				case EGRUL_PDF_SCHEMA.SIGN_SOLE_ENTITY_TYPE.IP:
				{
					return [EGRUL_PDF_SCHEMA.SCHEMA.SE.IP, 'IP'];
				}
				case EGRUL_PDF_SCHEMA.SIGN_SOLE_ENTITY_TYPE.KFH:
				{
					return [EGRUL_PDF_SCHEMA.SCHEMA.SE.KFH, 'KFH'];
				}
				default:
					return [undefined, undefined]
			}	
		}
		default:
			return [undefined, undefined];
	}
}

/**
 * Normalizes the source pdf data, retreived from 'less'
 *
 * @param {string} data - source pdf data, retreived from 'less'
 * @returns {Array} norm - normalized lines array
 */
var normalize = function(data) {
	return data
	// split to lines
	.split(/(\r?\n)/g)
	// filter by '\n' and 'empty string'
	.filter(function(i){ return i !== '\n' && i !== ''; })
	// trim leading spaces
	.map(function(i){ return i.replace(/^\s+/gm,'')})
	// delete footer's first string 
	.filter(function(i){ return 'Сведения с сайта ФНС России' !== i; })
	// delete footer's second string
	.filter(function(i){ return !(/Страница\s{1,2}\d{1,2}\s{1,2}из\s{1,2}/.test(i)); })
}

/**
 * Trims the normalized lines array accroding to skel
 *
 * @param {Array} src - source normalized lines array
 * @param {object} skel - skeleton
 * @param {trimCallback} cb - the callback that handles the trimming
 * @callback trimCallback
 * @param {err} error code
 * @param {data} success data
 */
var trim = function(src, skel, cb) {
	// trim leading
	var dst = (function(_l){
		for (var i in _l)
			if (/№\s{1,2}п\/п/.test(_l[i]))
				return _l.slice(+i + 2);
		return [];
	})(src);

	if(!dst.length)
		return cb('MISSING_START_BIT');
	
	// trim trailing
	var trail_indx = get_sect_indx(dst, skel[skel.length - 1].id);
	if (trail_indx !== undefined)
		dst = dst.slice(0, trail_indx[0]).concat(skel[skel.length - 1].id);
	else
		return cb('MISSING_STOP_BIT');
	
	
	if(!dst.length)
		return cb('MISSING_STOP_BIT');

	return cb(null, dst);
}

/**
 * Normalizes output data for 'SE' entity type (adds the 'name' and 'head' fields)
 *
 * @param {object} src - source object
 * @param {string} se_type - type of 'SE' entity
 */
var normalize_se = function(src, se_type) {
	src.type = 'SE';
	src.kind = se_type;

	src.name = {
		full: `${EGRUL_PDF_SCHEMA.SE_PREFIX[src.kind].full} ${src.common.surname} ${src.common.name} ${src.common.patronymic}`,
		short: `${EGRUL_PDF_SCHEMA.SE_PREFIX[src.kind].short} ${src.common.surname} ${src.common.name[0]}.${src.common.patronymic[0]}.`,
	};
	
	src.head = {
		surname: src.common.surname,
     	name: src.common.name,
     	patronymic: src.common.patronymic,
     	sex: src.common.sex
	};

	delete src.common; 
}

/**
 * Parses the source pdf data, retreived from 'less'
 *
 * @param {string} data - source pdf data, retreived from 'less'
 * @param {trimCallback} cb - the callback that handles the parsing
 * @callback trimCallback
 * @param {err} error code
 * @param {data} success data
 */
var parse = function (data, cb) {
	
	var lines = normalize(data);

	// detect entity type
	var [skel, e_type] = get_entity_type(lines);

	if ( undefined === skel )
		return cb('UNKNOWN_ENTITY_TYPE');

	trim(lines, skel, (err, data) => {
		if (err)
			return cb(err);

		var res_data = parse_sects(data, skel)
		
		res_data.type = e_type;
		
		if ('LE' != res_data.type)
			normalize_se(res_data, res_data.type);
		
		return cb(null, res_data);
	});
}

/**
 * Parses the EGRUL pdf file
 *
 * @param {string} file_name - base name of the pdf file
 * @param {string} dir_name - normalized path to the pdf file dir
 * @returns {object} defer - vow.defer pmoise 
 */
module.exports.parse = function(file_name, dir_name) {
	var d = vow.defer();

	var less = spawn('less', [file_name], { cwd: dir_name });

	less.stdout.setEncoding('utf8');

    var pdf_data = '';
    
    less.stdout.on('data', data => pdf_data += data );

    less.stdout.on('end', () => {
        parse(pdf_data, (err, data) => {
        	if (err)
        		return d.reject(err);
        	return d.resolve(data);
        });
    });

	return d.promise();
}